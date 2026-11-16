import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { Retc } from "../rpc.ts"

type ModelOption = {
  value: string
  label: string
}

export function PanelView(props: { readonly session: MountedSession }) {
  const ctx = usePlugin()
  const [text, setText] = createSignal("")
  const [status, setStatus] = createSignal("idle")
  const [model, setModel] = createSignal("")
  const [options, setOptions] = createSignal<ModelOption[]>([])
  let body: HTMLDivElement | undefined

  const rpc = () => ctx.client.rpc(Retc as any) as any

  const scroll = () => {
    if (body && body.scrollTop + body.clientHeight >= body.scrollHeight - 40) {
      body.scrollTop = body.scrollHeight
    }
  }

  const load = async (sessionID: string) => {
    try {
      const snapshot = await rpc().snapshot({ sessionID })
      setText(snapshot.text ?? "")
      setStatus(snapshot.status ?? "idle")
      setModel(snapshot.model ?? "")
    } catch {
      setText("")
      setStatus("idle")
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
    const off = rpc().events.on("reasoning", (event: any) => {
      const data = event.data ?? event
      if (data.sessionID !== props.session.id) return
      setText(data.text ?? "")
      setStatus(data.status ?? "live")
      if (data.model) setModel(data.model)
      scroll()
    })
    onCleanup(off)
  })

  createEffect(
    on(
      () => props.session.id,
      (sessionID) => {
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
          {text()}
        </Show>
      </div>
    </div>
  )
}
