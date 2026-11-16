/** @jsxImportSource @opentui/solid */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import {
  DEFAULT_MODEL,
  KV_KEY,
  supported,
  translate,
  type Health,
  type ModelChoice,
  type ModelRef,
  type View,
} from "./translate"

type Part = {
  id: string
  text: string
  committed: number
  enqueued: number
  complete: boolean
}

type Job = {
  text: string
  context: string
  result?: string
  error?: string
}

type Session = {
  part?: Part
  zh: string
  preview: string
  health: Health
  note: string
  jobs: Job[]
  inflight: number
  timer?: ReturnType<typeof setTimeout>
  lastEventAt: number
  active: boolean
  get: () => View
  set: (value: View) => void
}

const CONCURRENCY = 2
const TICK_MS = 700
const FINAL_MS = 2400
const MIN_CHUNK = 100
const MAX_CHUNK = 1200
const MAX_TAIL = 1600
const DEBUG = path.join(os.tmpdir(), "retc.log")

function debug(text: string) {
  if (!process.env.RETC_DEBUG) return
  try {
    fs.appendFileSync(DEBUG, `${new Date().toISOString()} ${text}\n`)
  } catch {}
}

function boundary(text: string) {
  let index = text.lastIndexOf("\n\n")
  if (index < MIN_CHUNK) index = text.lastIndexOf("\n")
  if (index < MIN_CHUNK) {
    const match = text.match(/[\s\S]*[。！？]/) || text.match(/[\s\S]*[.!?][\s"')\]]/)
    index = match ? match[0].length : -1
  }
  return index >= MIN_CHUNK ? Math.min(index + 1, MAX_CHUNK) : 0
}

function soft(text: string, max: number) {
  if (text.length <= max) return text.length
  const slice = text.slice(0, max)
  const index = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "))
  return index > max / 2 ? index + 1 : max
}

function tail(text: string) {
  if (text.length <= MAX_TAIL) return text
  return "…\n" + text.slice(-MAX_TAIL)
}

const tui: TuiPlugin = async (api, options) => {
  if (options && options.enabled === false) return
  debug("setup")

  const sessions = new Map<string, Session>()
  const stored = api.kv.get(KV_KEY, DEFAULT_MODEL) as unknown
  const [model, setModel] = createSignal(typeof stored === "string" && stored ? stored : DEFAULT_MODEL)

  const catalog = (): ModelChoice[] => {
    const out: ModelChoice[] = []
    const providers = api.state.provider ?? []
    for (const provider of providers) {
      const models = provider.models ?? {}
      for (const [id, item] of Object.entries(models)) {
        const ref: ModelRef = {
          providerID: provider.id,
          providerName: provider.name,
          modelID: id,
          apiID: (item && item.api && item.api.id) || id,
          apiUrl: (item && item.api && item.api.url) || "",
          apiNpm: (item && item.api && item.api.npm) || "",
          name: (item && item.name) || id,
          env: provider.env ?? [],
        }
        out.push({
          value: `${provider.id}/${id}`,
          label: ref.name,
          provider: provider.name,
          supported: supported(ref),
          ref,
        })
      }
    }
    const rank = (value: string) => (value.startsWith("opencode-go/") ? 0 : value.startsWith("opencode/") ? 1 : 2)
    out.sort((a, b) => rank(a.value) - rank(b.value) || a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label))
    return out
  }

  const current = (): ModelChoice | undefined => {
    const all = catalog()
    const hit = all.find((item) => item.value === model())
    if (hit) return hit
    const fallback = all.find((item) => item.value === DEFAULT_MODEL)
    if (fallback) return fallback
    return all.find((item) => item.supported)
  }

  const modelName = () => {
    const hit = current()
    return hit ? hit.label : model()
  }

  const publish = (session: Session) => {
    session.set({ zh: session.zh, preview: session.preview, health: session.health, note: session.note })
  }

  const ensure = (id: string): Session => {
    const hit = sessions.get(id)
    if (hit) return hit
    const [get, set] = createSignal<View>({ zh: "", preview: "", health: "idle", note: "" })
    const session: Session = {
      zh: "",
      preview: "",
      health: "idle",
      note: "",
      jobs: [],
      inflight: 0,
      lastEventAt: 0,
      active: false,
      get,
      set,
    }
    sessions.set(id, session)
    return session
  }

  const commit = (session: Session): boolean => {
    let moved = false
    while (session.jobs.length) {
      const head = session.jobs[0]
      if (typeof head.result === "string") {
        session.zh = session.zh.trim() ? session.zh.trimEnd() + "\n" + head.result : head.result
        if (session.part) session.part.committed += head.text.length
        session.jobs.shift()
        session.preview = ""
        moved = true
        continue
      }
      if (head.error) {
        session.jobs = []
        if (session.part) session.part.enqueued = session.part.committed
        session.preview = ""
        session.health = "error"
        session.note = head.error.slice(0, 90)
        debug("translate error: " + session.note)
        publish(session)
        return false
      }
      break
    }
    return moved
  }

  const finish = (session: Session) => {
    commit(session)
    if (session.health === "error") return
    session.health = session.inflight > 0 || session.jobs.length > 0 ? "translating" : "idle"
    if (session.health === "idle") session.note = ""
    publish(session)
    schedule(session)
  }

  const run = (session: Session, job: Job) => {
    const ref = current()?.ref
    if (!ref) {
      session.inflight -= 1
      job.error = "没有可用模型"
      finish(session)
      return
    }
    translate(ref, job.text, job.context, (partial) => {
      if (session.jobs[0] !== job) return
      session.preview = partial
      publish(session)
    })
      .then((result) => {
        job.result = result
      })
      .catch((error) => {
        job.error = String(error instanceof Error ? error.message : error)
      })
      .finally(() => {
        session.inflight -= 1
        finish(session)
      })
  }

  const pump = (session: Session) => {
    const part = session.part
    if (!part) return
    if (session.health === "error") return
    const final = part.complete || Date.now() - session.lastEventAt >= FINAL_MS
    while (session.inflight < CONCURRENCY) {
      const rest = part.text.slice(part.enqueued)
      if (!rest.trim()) break
      const size = final ? soft(rest, MAX_CHUNK) : boundary(rest)
      if (size <= 0) break
      const job: Job = {
        text: rest.slice(0, size),
        context: part.text.slice(Math.max(0, part.enqueued - 240), part.enqueued),
      }
      part.enqueued += size
      session.jobs.push(job)
      session.inflight += 1
      session.health = "translating"
      publish(session)
      run(session, job)
    }
    if (session.inflight === 0) {
      if (part.enqueued < part.text.length) {
        schedule(session)
      } else {
        session.health = "idle"
        session.note = ""
        publish(session)
      }
    }
  }

  const schedule = (session: Session) => {
    if (session.timer) return
    const part = session.part
    if (!part) return
    if (part.enqueued >= part.text.length && session.inflight === 0) return
    session.timer = setTimeout(() => {
      session.timer = undefined
      pump(session)
    }, TICK_MS)
  }

  const onPart = (event: any) => {
    const props = event && event.properties
    const part = props && props.part
    if (!part || part.type !== "reasoning" || typeof part.text !== "string" || !part.text) return
    const sid = typeof part.sessionID === "string" ? part.sessionID : props.sessionID
    if (typeof sid !== "string") return
    const session = ensure(sid)
    if (!session.part || session.part.id !== part.id) {
      if (session.zh.trim()) session.zh = session.zh.trimEnd() + "\n\n"
      session.part = { id: part.id, text: part.text, committed: 0, enqueued: 0, complete: false }
      session.jobs = []
      session.preview = ""
      session.health = "idle"
      session.note = ""
    } else {
      session.part.text = part.text
    }
    session.part.complete = Boolean(part.time && part.time.end)
    session.lastEventAt = Date.now()
    publish(session)
    if (session.active) pump(session)
  }

  api.event.on("message.part.updated", onPart)

  const openPicker = () => {
    const all = catalog()
    if (all.length === 0) {
      api.ui.toast({ message: "还没有可用的模型，请先连接 provider", variant: "warning", duration: 3000 })
      return
    }
    const currentValue = current()?.value
    const DialogSelect = api.ui.DialogSelect
    api.ui.dialog.setSize("large")
    api.ui.dialog.replace(() => (
      <DialogSelect
        title="思考翻译模型"
        placeholder="搜索模型…"
        current={currentValue}
        options={all.map((item) => ({
          title: item.label,
          value: item.value,
          category: item.provider,
          description: item.value + (item.supported ? "" : " · 接口协议暂不支持"),
          disabled: !item.supported,
        }))}
        onSelect={(option: { value: unknown }) => {
          api.ui.dialog.clear()
          const value = String(option.value)
          setModel(value)
          api.kv.set(KV_KEY, value)
          for (const session of sessions.values()) {
            session.health = "idle"
            session.note = ""
            if (session.part) session.part.enqueued = session.part.committed
            session.jobs = []
            publish(session)
          }
          api.ui.toast({ message: "翻译模型已切换", variant: "success", duration: 2000 })
          debug("model -> " + value)
        }}
      />
    ))
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "retc.model",
        title: "Retc: 选择思考翻译模型",
        category: "Retc",
        namespace: "palette",
        slashName: "retc-model",
        run() {
          openPicker()
        },
      },
    ],
  })

  const block = (ctx: any, value: { session_id: string }) => {
    const session = ensure(value.session_id)
    session.active = true
    if (session.part && session.part.enqueued < session.part.text.length && session.health !== "error") pump(session)
    const theme = ctx.theme.current
    const badge = () => {
      const view = session.get()
      if (view.health === "error") return "翻译失败 " + view.note
      if (view.health === "translating") return "翻译中…"
      return ""
    }
    const body = () => {
      const view = session.get()
      const text = view.zh + (view.preview ? (view.zh.trim() ? "\n" : "") + view.preview : "")
      if (text) return tail(text)
      if (view.health === "error") return "译文不可用，英文思考仍可在对话里查看。"
      if (view.health === "translating") return "翻译中…"
      return "等待思考…"
    }

    return (
      <box
        border
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        gap={1}
        width="100%"
      >
        <box onMouseUp={openPicker} flexDirection="column">
          <text fg={theme.primary}>
            <b>思考译文</b>
            <span style={{ fg: theme.textMuted }}> {modelName()} ▾</span>
          </text>
          {badge() ? (
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.textMuted }}>{badge()}</span>
            </text>
          ) : null}
        </box>
        <text fg={theme.text}>{body()}</text>
      </box>
    )
  }

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content: block,
    },
  })

  api.lifecycle.onDispose(() => {
    for (const session of sessions.values()) {
      if (session.timer) clearTimeout(session.timer)
      session.timer = undefined
    }
  })

  api.ui.toast({ message: "思考译文已启用（右侧栏，点击标题可换模型）", variant: "info", duration: 2600 })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "retc",
  tui,
}

export default plugin
