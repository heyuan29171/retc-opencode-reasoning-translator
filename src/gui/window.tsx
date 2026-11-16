import { Command, MenuItem, Panel, SettingsPage, Style, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import { PanelView } from "./panel.tsx"
import { SettingsView } from "./settings.tsx"
import css from "./style.css?inline"

export const setup: Plugin.Setup = (ctx) => {
  const key = `${ctx.id}:main`

  ctx.add(Style, css)

  const tab: PanelTab = {
    id: "main",
    get title() {
      return "思考译文"
    },
    closable: "compact",
    fallback: true,
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    width: "narrow",
    mobile: {
      get title() {
        return "思考译文"
      },
      order: 50,
      kind: "menu",
      icon: "extensions",
    },
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (props) => <PanelView session={props.session} />,
  })

  const toggle = () => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.toggle(key, session)
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "toggle",
      title: "retc: 思考译文",
      group: "Retc",
      section: "session",
      enabled: !!ctx.sessions.current(),
      run: toggle,
    }),
  )

  ctx.add(
    MenuItem,
    (): MenuItem => {
      const session = ctx.sessions.current()
      return {
        menu: "session.panel",
        id: "open",
        title: "思考译文",
        icon: "extensions",
        keybind: `${ctx.id}.toggle`,
        opened: !!session && ctx.layout.state(key, session) !== "closed",
        run: () => {
          if (session) ctx.layout.open(key, session)
        },
      }
    },
  )

  ctx.add(SettingsPage, {
    id: ctx.id,
    icon: "extensions",
    get title() {
      return "思考译文"
    },
    get entries() {
      return [
        { id: `${ctx.id}.style`, title: "样式", description: "背景、文字颜色、字体、字号、行高" },
      ]
    },
    render: (input) => <SettingsView highlight={input.target} />,
  })
}
