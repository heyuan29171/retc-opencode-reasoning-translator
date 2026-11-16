import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { Retc } from "../rpc.ts"
import type { definition } from "./definition.ts"

type ModelOption = {
  value: string
  label: string
}

type Update = {
  text: string
  stable?: string
  preview?: string
  status: string
  model?: string
}

function Field(props: { label: string; value: string; onInput: (value: string) => void }) {
  return (
    <label class="retc-field">
      <span class="retc-field-label">{props.label}</span>
      <input
        class="retc-input"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </label>
  )
}

export function PanelView(props: { readonly session: MountedSession }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const [stable, setStable] = createSignal("")
  const [preview, setPreview] = createSignal("")
  const [status, setStatus] = createSignal("idle")
  const [model, setModel] = createSignal("")
  const [options, setOptions] = createSignal<ModelOption[]>([])
  let body: HTMLDivElement | undefined
  let stick = true
  let programmaticUntil = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Update | undefined

  const rpc = () => ctx.client.rpc(Retc as any) as any
  const skin = () => ctx.stores.style.value
  const full = () => stable() + (preview() ? (stable() ? "\n\n" : "") + preview() : "")

  const variables = () => ({
    "--retc-bg": skin().bg,
    "--retc-fg": skin().fg,
    "--retc-border": skin().border,
    "--retc-font": skin().font,
    "--retc-size": `${skin().size}px`,
    "--retc-line": String(skin().line),
  })

  const pin = () => {
    if (!stick) return
    programmaticUntil = Date.now() + 150
    requestAnimationFrame(() => {
      if (body) body.scrollTop = body.scrollHeight
    })
  }

  const apply = (update: Update) => {
    pending = undefined
    if (typeof update.stable === "string") {
      setStable(update.stable)
      setPreview(update.preview ?? "")
    } else {
      setStable(update.text)
      setPreview("")
    }
    setStatus(update.status)
    if (update.model) setModel(update.model)
    pin()
  }

  const queue = (update: Update) => {
    pending = update
    if (update.status !== "live") {
      if (timer) clearTimeout(timer)
      timer = undefined
      apply(update)
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      if (pending) apply(pending)
    }, 260)
  }

  const load = async (sessionID: string) => {
    try {
      const snapshot = await rpc().snapshot({ sessionID })
      apply({ text: snapshot.text ?? "", status: snapshot.status ?? "idle", model: snapshot.model ?? "" })
    } catch {
      apply({ text: "", status: "idle" })
    }
  }

  const models = async () => {
    try {
      const result = await rpc().models({})
      const list: ModelOption[] = (result.models ?? []).map((item: any) => ({
        value: `${item.providerID}/${item.id}`,
        label: `${item.name} · ${item.providerID}`,
      }))
      setOptions(list.sort((a: ModelOption, b: ModelOption) => a.label.localeCompare(b.label)))
      const settings = await rpc().getSettings({})
      if (settings?.model) setModel(settings.model)
    } catch {}
  }

  onMount(() => {
    void models()
    const onScroll = () => {
      if (!body) return
      if (Date.now() < programmaticUntil) return
      stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 30
    }
    body?.addEventListener("scroll", onScroll)
    const off = rpc().events.on("reasoning", (event: any) => {
      const data = event.data ?? event
      if (data.sessionID !== props.session.id) return
      queue({
        text: data.text ?? "",
        stable: data.stable,
        preview: data.preview,
        status: data.status ?? "live",
        model: data.model,
      })
    })
    onCleanup(() => {
      off()
      body?.removeEventListener("scroll", onScroll)
      if (timer) clearTimeout(timer)
    })
  })

  createEffect(
    on(
      () => props.session.id,
      (sessionID) => {
        stick = true
        setStable("")
        setPreview("")
        setStatus("idle")
        void load(sessionID)
      },
    ),
  )

  const change = async (value: string) => {
    setModel(value)
    try {
      await rpc().setSettings({ model: value })
    } catch {}
  }

  const [showSettings, setShowSettings] = createSignal(false)
  const store = () => ctx.stores.style
  const field = (key: "bg" | "fg" | "border" | "font", value: string) => {
    store().update((draft) => {
      draft[key] = value
    })
  }
  const number = (key: "size" | "line", value: string) => {
    const next = Number(value)
    if (!Number.isFinite(next) || next <= 0) return
    store().update((draft) => {
      draft[key] = next
    })
  }
  const preset = (kind: "light" | "dark") => {
    store().update((draft) => {
      if (kind === "light") {
        draft.bg = "#9a9a9a"
        draft.fg = "#141414"
        draft.border = "#666666"
        return
      }
      draft.bg = "#2b2b2b"
      draft.fg = "#e6e6e6"
      draft.border = "#555555"
    })
  }

  return (
    <div class="retc-panel" style={variables() as any}>
      <div class="retc-head">
        <span class="retc-dot" data-status={status()} />
        <span class="retc-title">思考译文</span>
        <select
          class="retc-select"
          title={model()}
          value={model()}
          onChange={(event) => void change(event.currentTarget.value)}
        >
          <Show when={options().length === 0}>
            <option value={model()}>{model() || "默认模型"}</option>
          </Show>
          {options().map((item) => (
            <option value={item.value}>{item.label}</option>
          ))}
        </select>
        <button class="retc-gear" title="样式设置" onClick={() => setShowSettings(!showSettings())}>
          ⚙
        </button>
      </div>
      <Show when={showSettings()}>
        <div class="retc-settings">
          <div class="retc-settings-row">
            <ui.Button onClick={() => preset("light")}>浅灰</ui.Button>
            <ui.Button onClick={() => preset("dark")}>深灰</ui.Button>
          </div>
          <Field label="背景色" value={skin().bg} onInput={(value) => field("bg", value)} />
          <Field label="文字色" value={skin().fg} onInput={(value) => field("fg", value)} />
          <Field label="边框色" value={skin().border} onInput={(value) => field("border", value)} />
          <Field label="字体（留空继承）" value={skin().font} onInput={(value) => field("font", value)} />
          <Field label="字号 px" value={String(skin().size)} onInput={(value) => number("size", value)} />
          <Field label="行高" value={String(skin().line)} onInput={(value) => number("line", value)} />
        </div>
      </Show>
      <div class="retc-body" classList={{ empty: !full(), error: status() === "error" }} ref={body}>
        <Show when={full()} fallback={status() === "live" ? "翻译中…" : "等待思考…"}>
          <Show
            when={status() === "done"}
            fallback={<div class="retc-plain">{full()}</div>}
          >
            <ui.Markdown text={full()} />
          </Show>
        </Show>
      </div>
    </div>
  )
}
