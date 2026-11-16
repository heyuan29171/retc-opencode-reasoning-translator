import { usePlugin } from "@opencode/plugin/gui"
import type { definition } from "./definition.ts"

export function SettingsView(_props: { readonly highlight?: string }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const style = ctx.stores.style

  const set = (key: "bg" | "fg" | "border" | "font", value: string) => {
    style.update((draft) => {
      draft[key] = value
    })
  }

  const setNumber = (key: "size" | "line", value: string) => {
    const next = Number(value)
    if (!Number.isFinite(next) || next <= 0) return
    style.update((draft) => {
      draft[key] = next
    })
  }

  const preset = (kind: "light" | "dark") => {
    style.update((draft) => {
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
    <div class="retc-settings">
      <div class="retc-settings-row">
        <ui.Button onClick={() => preset("light")}>浅灰</ui.Button>
        <ui.Button onClick={() => preset("dark")}>深灰</ui.Button>
      </div>
      <ui.TextInput label="背景颜色" value={style.value.bg} onInput={(value) => set("bg", value)} />
      <ui.TextInput label="文字颜色" value={style.value.fg} onInput={(value) => set("fg", value)} />
      <ui.TextInput label="边框颜色" value={style.value.border} onInput={(value) => set("border", value)} />
      <ui.TextInput
        label="字体（留空继承 OpenCode）"
        value={style.value.font}
        onInput={(value) => set("font", value)}
      />
      <ui.TextInput label="字号（px）" value={String(style.value.size)} onInput={(value) => setNumber("size", value)} />
      <ui.TextInput label="行高" value={String(style.value.line)} onInput={(value) => setNumber("line", value)} />
    </div>
  )
}
