import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Plugin } from "@opencode/plugin"
import { Retc } from "./rpc.ts"

const DEFAULT_MODEL = "zhipuai/glm-4.6v"
const AUTH = path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
const ZHIPU = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
const SYSTEM = [
  "You translate an AI coding assistant's private reasoning into Simplified Chinese.",
  "Output only the Chinese translation, with no preamble or notes.",
  "Keep code, file paths, commands, identifiers, URLs, numbers and Markdown syntax unchanged.",
  "If the input is already Chinese, return it unchanged.",
].join("\n")

type State = {
  sessionID: string
  partID: string
  text: string
  done: number
  zh: string
  preview: string
  busy: boolean
  complete: boolean
  last: number
  timer?: ReturnType<typeof setTimeout>
}

type Latest = {
  text: string
  status: string
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

function zhipuKey() {
  const env = process.env.ZHIPUAI_API_KEY
  if (env && env.trim()) return env.trim()
  try {
    const json = JSON.parse(fs.readFileSync(AUTH, "utf8"))
    const key = json?.zhipuai?.key
    return typeof key === "string" ? key.trim() : ""
  } catch {
    return ""
  }
}

function clean(text: string) {
  let out = text
  out = out.replace(/^(?:好的|当然|没问题|以下是|这是|我来)[^\n]{0,60}?[：:]\s*/u, "")
  out = out.replace(/^(?:好的|当然|没问题)[^\n]{0,60}?\n+/u, "")
  out = out.replace(/^-{3,}\s*\n?/, "")
  return out.trimStart()
}

async function zhipuTranslate(model: string, text: string, onDelta: (text: string) => void) {
  const key = zhipuKey()
  if (!key) throw new Error("缺少 zhipuai API key")
  const res = await fetch(ZHIPU, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      stream: true,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!res.ok) throw new Error(`zhipuai HTTP ${res.status}`)
  if (!res.body) throw new Error("zhipuai 无响应体")
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let out = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf("\n")
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim()
        if (payload && payload !== "[DONE]") {
          try {
            const json = JSON.parse(payload)
            const delta = json?.choices?.[0]?.delta?.content
            if (typeof delta === "string" && delta) {
              out += delta
              onDelta(clean(out))
            }
          } catch {}
        }
      }
      index = buffer.indexOf("\n")
    }
  }
  return clean(out)
}

export default Plugin.define({
  id: "retc",
  async setup(ctx) {
    let settings = { model: DEFAULT_MODEL }
    try {
      const saved: any = await ctx.storage.get("settings")
      if (saved && typeof saved.model === "string" && saved.model.includes("/")) settings = { model: saved.model }
    } catch {}

    const states = new Map<string, State>()
    const latest = new Map<string, Latest>()

    const ref = () => {
      const [providerID, ...rest] = settings.model.split("/")
      return { providerID, id: rest.join("/") }
    }

    const reg = await ctx.rpc.register(Retc as any, {
      snapshot: async (input: any) => {
        const hit = latest.get(input.sessionID)
        return hit ?? { text: "", status: "idle", model: settings.model }
      },
      models: async () => {
        const result: any = await ctx.model.list()
        const list: any[] = Array.isArray(result) ? result : result?.data ?? []
        return {
          models: list.map((model) => ({
            providerID: model.providerID,
            id: model.id,
            name: model.name ?? model.id,
          })),
        }
      },
      getSettings: async () => ({ model: settings.model }),
      setSettings: async (input: any) => {
        settings = { model: input.model }
        await ctx.storage.set("settings", settings)
        return { ok: true }
      },
    })

    const emit = (state: State, status: string) => {
      const view = state.zh + (state.preview ? (state.zh ? "\n\n" : "") + state.preview : "")
      latest.set(state.sessionID, { text: view, status, model: settings.model })
      void reg.events
        .emit("reasoning", {
          sessionID: state.sessionID,
          partID: state.partID,
          text: view,
          status,
          model: settings.model,
        })
        .catch(() => {})
    }

    const prompt = (text: string) => [SYSTEM, "", "Text:", text].join("\n")

    const ask = async (text: string, onDelta: (text: string) => void) => {
      const target = ref()
      if (target.providerID === "zhipuai") {
        try {
          return await zhipuTranslate(target.id, text, onDelta)
        } catch (error) {
          if (target.id === "glm-4.5-air") throw error
          return zhipuTranslate("glm-4.5-air", text, onDelta)
        }
      }
      const result = await ctx.experimental.generate.text({ model: target, prompt: prompt(text) })
      const out = clean(result.text)
      onDelta(out)
      return out
    }

    const schedule = (state: State) => {
      if (state.timer) return
      state.timer = setTimeout(() => {
        state.timer = undefined
        void pump(state)
      }, 600)
    }

    const pump = async (state: State) => {
      if (state.busy) return
      const rest = state.text.slice(state.done)
      if (!rest.trim()) {
        if (state.complete) emit(state, "done")
        else schedule(state)
        return
      }
      const final = state.complete || Date.now() - state.last > 2400
      const size = final ? Math.min(rest.length, 3000) : boundary(rest)
      if (size <= 0) {
        schedule(state)
        return
      }
      const chunk = rest.slice(0, size)
      if (!/[A-Za-z\u4e00-\u9fff]{2}/.test(chunk)) {
        state.done += size
        void pump(state)
        return
      }
      state.busy = true
      state.preview = ""
      emit(state, "live")
      try {
        const zh = await ask(chunk, (partial) => {
          state.preview = partial
          emit(state, "live")
        })
        state.done += size
        if (zh.trim()) state.zh = state.zh ? state.zh + "\n\n" + zh : zh
        state.preview = ""
        state.busy = false
        emit(state, state.complete && state.done >= state.text.length ? "done" : "live")
        if (state.done < state.text.length || !state.complete) void pump(state)
      } catch {
        state.preview = ""
        state.busy = false
        emit(state, "error")
      }
    }

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ["session.reasoning.started", "session.reasoning.delta", "session.reasoning.ended"],
          signal: controller.signal,
        })) {
          const data: any = (event as any).data
          if (!data || typeof data.sessionID !== "string") continue
          const sid: string = data.sessionID
          const partID = `${data.assistantMessageID ?? ""}:${data.ordinal ?? 0}`
          let state = states.get(sid)
          if (!state || state.partID !== partID) {
            state = {
              sessionID: sid,
              partID,
              text: "",
              done: 0,
              zh: "",
              preview: "",
              busy: false,
              complete: false,
              last: Date.now(),
            }
            states.set(sid, state)
            emit(state, "idle")
          }
          if (event.type === "session.reasoning.started") {
            state.text = ""
          } else if (event.type === "session.reasoning.delta") {
            state.text += typeof data.delta === "string" ? data.delta : ""
          } else {
            state.text = typeof data.text === "string" ? data.text : state.text
            state.complete = true
          }
          state.last = Date.now()
          if (!state.text.trim()) continue
          if (!/[A-Za-z]{3}/.test(state.text)) {
            if (state.complete) emit(state, "done")
            continue
          }
          void pump(state)
        }
      } catch {}
    })()

    return () => {
      controller.abort()
      void reg.dispose()
    }
  },
})
