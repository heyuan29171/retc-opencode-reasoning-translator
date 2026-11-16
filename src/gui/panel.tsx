import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { Retc } from "../rpc.ts"

type ModelOption = {
  value: string
  label: string
}

type Update = {
  text: string
  status: string
  model?: string
}

export function PanelView(props: { readonly session: MountedSession }) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const [text, setText] = createSignal("")
  const [status, setStatus] = createSignal("idle")
  const [model, setModel] = createSignal("")
  const [options, setOptions] = createSignal<ModelOption[]>([])
  let body: HTMLDivElement | undefined
  let stick = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Update | undefined

  const rpc = () => ctx.client.rpc(Retc as any) as any

  const pin = () => {
    if (!stick) return
    requestAnimationFrame(() => {
      if (body) body.scrollTop = body.scrollHeight
    })
  }

  const apply = (update: Update) => {
    pending = undefined
    setText(update.text)
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
    }, 160)
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
      const result = await rpc().models()
      const list: ModelOption[] = (result.models ?? []).map((item: any) => ({
        value: `${item.providerID}/${item.id}`,
        label: `${item.name} · ${item.providerID}`,
      }))
      setOptions(list.sort((a: ModelOption, b: ModelOption) => a.label.localeCompare(b.label)))
      const settings = await rpc().getSettings()
      if (settings?.model) setModel(settings.model)
    } catch {}
  }

  onMount(() => {
    void models()
    const onScroll = () => {
      if (!body) return
      stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 30
    }
    body?.addEventListener("scroll", onScroll)
    const off = rpc().events.on("reasoning", (event: any) => {
      const data = event.data ?? event
      if (data.sessionID !== props.session.id) return
      queue({ text: data.text ?? "", status: data.status ?? "live", model: data.model })
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
        setText("")
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

  return (
    <div class="retc-panel">
      <div class="retc-head">
        <span class="retc-dot" data-status={status()} />
        <span class="retc-title">思考译文</span>
        <select class="retc-select" value={model()} onChange={(event) => void change(event.currentTarget.value)}>
          {options().map((item) => (
            <option value={item.value}>{item.label}</option>
          ))}
        </select>
      </div>
      <div class="retc-body" classList={{ empty: !text(), error: status() === "error" }} ref={body}>
        <Show when={text()} fallback={status() === "live" ? "翻译中…" : "等待思考…"}>
          <ui.Markdown text={text()} />
        </Show>
      </div>
    </div>
  )
}
