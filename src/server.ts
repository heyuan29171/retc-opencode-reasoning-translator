import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DEFAULT_MODEL, translate, type ModelRef } from "./translate"
import { createPanel } from "./panel"

const MARK = "【中文翻译】"
const STRIP = /\n*【中文翻译】\n[\s\S]*$/
const DEFAULT_PORT = 4791
const HEAD = "【思考译文】\n"

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
  flush?: ReturnType<typeof setTimeout>
  tp?: any
  model: string
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
  const panel = options?.panel === true ? createPanel(port) : null
  log(panel ? `panel on http://127.0.0.1:${panel.port}/` : "panel disabled")

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

  const write = async (part: any) => {
    const api: any = client as any
    const body = { ...part }
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

  const ensurePart = (st: Rx) => {
    if (st.tp) return st.tp
    const now = Date.now()
    st.tp = {
      id: st.part.id + "0",
      sessionID: st.sid,
      messageID: st.part.messageID,
      type: "text",
      text: HEAD + "（翻译中…）",
      time: { start: now },
      metadata: { retc: true },
    }
    void write(st.tp).catch((error) => log("create part error: " + String(error instanceof Error ? error.message : error)))
    return st.tp
  }

  const paint = (st: Rx) => {
    if (!st.tp || !st.zh) return
    st.tp.text = HEAD + st.zh
    st.tp.time = { start: (st.tp.time && st.tp.time.start) || Date.now(), end: Date.now() }
    void write(st.tp).catch((error) => log("paint error: " + String(error instanceof Error ? error.message : error)))
  }

  const schedulePaint = (st: Rx) => {
    if (!inline) return
    if (st.flush) return
    st.flush = setTimeout(() => {
      st.flush = undefined
      paint(st)
    }, 400)
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
    if (st.tp) {
      st.tp.text = HEAD + (st.zh || "") + (st.zh ? "\n\n" : "") + "（翻译失败：" + note + "）"
      st.tp.time = { start: (st.tp.time && st.tp.time.start) || Date.now(), end: Date.now() }
      void write(st.tp).catch(() => {})
    }
  }

  const pump = async (st: Rx) => {
    if (st.busy) return
    const rest = st.text.slice(st.done)
    if (!rest.trim()) {
      if (!st.complete) schedule(st)
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
        st.zh = join(partial)
        schedulePaint(st)
      })
      st.done += size
      st.zh = join(out)
      st.busy = false
      schedulePaint(st)
      if (st.done < st.text.length || !st.complete) pump(st)
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
      }
      states.set(part.id, st)
      ensurePart(st)
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
      let removed = 0
      let stripped = 0
      for (const message of output.messages as any[]) {
        if (!message || !Array.isArray(message.parts)) continue
        const next = message.parts.filter((part: any) => {
          if (part && part.metadata && part.metadata.retc) {
            removed += 1
            return false
          }
          return true
        })
        if (next.length !== message.parts.length) message.parts = next
        for (const part of message.parts) {
          if ((part.type === "reasoning" || part.type === "text") && typeof part.text === "string" && part.text.includes(MARK)) {
            part.text = part.text.replace(STRIP, "")
            stripped += 1
          }
        }
      }
      if (removed || stripped) log(`removed ${removed} retc part(s), stripped ${stripped} marker(s) before request`)
    },
    event: async ({ event }) => {
      if (event.type !== "message.part.updated") return
      onPart((event as any).properties?.part)
    },
  }
}

export default { id: "retc", server: plugin }
