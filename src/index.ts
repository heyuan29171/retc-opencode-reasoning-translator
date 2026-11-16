import { Plugin } from "@opencode/plugin"
import { Retc } from "./rpc.ts"

const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash"
const HEAD = "【思考译文】\n"

type State = {
  sessionID: string
  partID: string
  text: string
  done: number
  zh: string
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
      latest.set(state.sessionID, { text: HEAD + state.zh, status, model: settings.model })
      void reg.events
        .emit("reasoning", {
          sessionID: state.sessionID,
          partID: state.partID,
          text: state.zh,
          status,
          model: settings.model,
        })
        .catch(() => {})
    }

    const ask = async (text: string) => {
      const result = await ctx.experimental.generate.text({
        model: ref(),
        prompt: [
          "You translate an AI coding assistant's private reasoning into Simplified Chinese.",
          "Output only the Chinese translation, with no preamble or notes.",
          "Keep code, file paths, commands, identifiers, URLs, numbers and Markdown syntax unchanged.",
          "If the input is already Chinese, return it unchanged.",
          "",
          "Text:",
          text,
        ].join("\n"),
      })
      return result.text.trim()
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
      state.busy = true
      emit(state, "live")
      try {
        const zh = await ask(chunk)
        state.done += size
        state.zh = state.zh ? state.zh + "\n" + zh : zh
        state.busy = false
        emit(state, state.complete && state.done >= state.text.length ? "done" : "live")
        if (state.done < state.text.length || !state.complete) void pump(state)
      } catch {
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
