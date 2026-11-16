import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DEFAULT_MODEL, translate, type ModelRef } from "./translate"
import { createPanel } from "./panel"

const MARK = "【中文翻译】"
const STRIP = /\n*【中文翻译】\n[\s\S]*$/
const DEFAULT_PORT = 4791

function log(text: string) {
  if (!process.env.RETC_DEBUG) return
  try {
    fs.appendFileSync(path.join(os.tmpdir(), "retc.log"), `${new Date().toISOString()} ${text}\n`)
  } catch {}
}

type Target = {
  providerID: string
  modelID: string
}

type Rx = {
  sid: string
  part: any
  text: string
  done: number
  zh: string
  busy: boolean
  complete: boolean
  last: number
  timer?: ReturnType<typeof setTimeout>
  model: string
  patched: boolean
}

function boundary(text: string) {
  let index = text.lastIndexOf("\n\n")
  if (index < 120) index = text.lastIndexOf("\n")
  if (index < 120) {
    const match = text.match(/[\s\S]*[。！？]/) || text.match(/[\s\S]*[.!?][\s"')\]]/)
    index = match ? match[0].length : -1
  }
  return index >= 120 ? Math.min(index + 1, 1600) : 0
}

function soft(text: string) {
  if (text.length <= 3000) return text.length
  const slice = text.slice(0, 3000)
  const index = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "))
  return index > 1500 ? index + 1 : 3000
}

export const plugin: Plugin = async ({ client }, options) => {
  const sessionModel = new Map<string, Target>()
  const refs = new Map<string, ModelRef>()
  const states = new Map<string, Rx>()
  let providers: any[] | null = null

  const forced = typeof options?.model === "string" && options.model.includes("/") ? options.model : undefined
  const inline = options?.inline !== false
  const port = typeof options?.port === "number" ? options.port : DEFAULT_PORT
  const panel = options?.panel === false ? null : createPanel(port)
  log(panel ? `panel on http://127.0.0.1:${panel.port}/` : "panel unavailable")

  const catalog = async () => {
    if (providers) return providers
    try {
      const res: any = await client.config.providers()
      providers = res?.data?.providers ?? []
    } catch {
      providers = []
    }
    return providers
  }

  const refFor = async (target: Target): Promise<ModelRef | null> => {
    const all = await catalog()
    const provider = all.find((item: any) => item.id === target.providerID)
    const model = provider && provider.models ? provider.models[target.modelID] : undefined
    if (!provider || !model) return null
    return {
      providerID: provider.id,
      providerName: provider.name,
      modelID: target.modelID,
      apiID: (model.api && model.api.id) || target.modelID,
      apiUrl: (model.api && model.api.url) || "",
      apiNpm: (model.api && model.api.npm) || "",
      name: model.name || target.modelID,
      env: provider.env || [],
    }
  }

  const chosen = async (sessionID: string): Promise<ModelRef | null> => {
    if (forced) {
      const [providerID, ...rest] = forced.split("/")
      const hit = await refFor({ providerID, modelID: rest.join("/") })
      if (hit) return hit
    }
    const cached = refs.get(sessionID)
    if (cached) return cached
    const current = sessionModel.get(sessionID)
    const hit = current ? await refFor(current) : null
    if (hit) {
      refs.set(sessionID, hit)
      return hit
    }
    const [providerID, ...rest] = DEFAULT_MODEL.split("/")
    return refFor({ providerID, modelID: rest.join("/") })
  }

  const write = async (part: any, text: string) => {
    const api: any = client as any
    const body = { ...part, text }
    if (api.part && typeof api.part.update === "function") {
      await api.part.update({
        path: { sessionID: part.sessionID, messageID: part.messageID, partID: part.id },
        body,
      })
      return
    }
    if (api._client && typeof api._client.patch === "function") {
      await api._client.patch({
        url: `/session/${part.sessionID}/message/${part.messageID}/part/${part.id}`,
        body,
      })
      return
    }
    throw new Error("当前版本不支持更新消息 part")
  }

  const schedule = (st: Rx) => {
    if (st.timer) return
    st.timer = setTimeout(() => {
      st.timer = undefined
      pump(st)
    }, 700)
  }

  const fail = (st: Rx, note: string) => {
    log("server error: " + note)
    panel?.push({ sid: st.sid, part: st.part.id, zh: st.zh, status: "error", model: st.model, note })
  }

  const finish = async (st: Rx) => {
    if (!st.zh.trim()) return
    panel?.push({ sid: st.sid, part: st.part.id, zh: st.zh, status: "done", model: st.model })
    if (!inline || st.patched) return
    st.patched = true
    try {
      await write(st.part, st.part.text + "\n\n" + MARK + "\n" + st.zh)
    } catch (error) {
      log("patch error: " + String(error instanceof Error ? error.message : error))
    }
  }

  const pump = async (st: Rx) => {
    if (st.busy) return
    const rest = st.text.slice(st.done)
    if (!rest.trim()) {
      if (st.complete) await finish(st)
      else schedule(st)
      return
    }
    const final = st.complete || Date.now() - st.last > 2400
    const size = final ? soft(rest) : boundary(rest)
    if (size <= 0) {
      schedule(st)
      return
    }
    const ref = await chosen(st.sid)
    if (!ref) {
      fail(st, "没有可用的翻译模型")
      return
    }
    if (st.busy) return
    st.busy = true
    st.model = ref.name
    const chunk = rest.slice(0, size)
    const base = st.zh
    const join = (text: string) => (base.trim() ? base.trimEnd() + "\n" + text : text)
    try {
      const out = await translate(ref, chunk, "", (partial) => {
        panel?.push({ sid: st.sid, part: st.part.id, zh: join(partial), status: "live", model: ref.name })
      })
      st.done += size
      st.zh = join(out)
      st.busy = false
      panel?.push({
        sid: st.sid,
        part: st.part.id,
        zh: st.zh,
        status: st.complete && st.done >= st.text.length ? "done" : "live",
        model: ref.name,
      })
      if (st.done < st.text.length || !st.complete) pump(st)
      else await finish(st)
    } catch (error) {
      st.busy = false
      fail(st, String(error instanceof Error ? error.message : error))
    }
  }

  const onPart = (part: any) => {
    if (!part || part.type !== "reasoning" || typeof part.text !== "string" || !part.text) return
    if (part.text.includes(MARK)) return
    if (!/[A-Za-z]{3}/.test(part.text)) return
    let st = states.get(part.id)
    if (!st) {
      st = {
        sid: part.sessionID,
        part,
        text: part.text,
        done: 0,
        zh: "",
        busy: false,
        complete: false,
        last: Date.now(),
        model: "",
        patched: false,
      }
      states.set(part.id, st)
      panel?.push({ sid: part.sessionID, part: part.id, zh: "", status: "idle", model: "" })
    }
    st.part = part
    st.text = part.text
    st.complete = Boolean(part.time && part.time.end)
    st.last = Date.now()
    pump(st)
  }

  return {
    dispose: async () => {
      panel?.close()
    },
    "chat.params": async (input) => {
      if (!input.model) return
      sessionModel.set(input.sessionID, { providerID: input.model.providerID, modelID: input.model.id })
      refs.delete(input.sessionID)
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      let stripped = 0
      for (const message of output.messages as any[]) {
        const parts = message && message.parts
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          if ((part.type === "reasoning" || part.type === "text") && typeof part.text === "string" && part.text.includes(MARK)) {
            part.text = part.text.replace(STRIP, "")
            stripped += 1
          }
        }
      }
      if (stripped) log(`stripped ${stripped} translated part(s) before request`)
    },
    event: async ({ event }) => {
      if (event.type !== "message.part.updated") return
      onPart((event as any).properties?.part)
    },
  }
}

export default { id: "retc", server: plugin }
