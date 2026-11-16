# retc — reasoning english to chinese

把模型**英文思考过程（reasoning）**实时翻译成简体中文，给 OpenCode 用。

同一个仓库提供两种形态：

| 形态 | 适用 | 效果 |
| --- | --- | --- |
| **Server 插件** | OpenCode **Desktop**、`opencode run`、终端 TUI | ① 右侧**独立小窗**流式显示译文 ② 思考块末尾追加「【中文翻译】」 |
| **TUI 插件** | 终端 `opencode`（TUI = terminal UI） | 右侧栏内嵌流式译文，点击标题切换翻译模型 |

### 先说清楚：TUI 是什么

- **TUI** = 终端界面，就是在 PowerShell / Windows Terminal 里敲 `opencode` 打开的字符界面
- **Desktop** = 现在这个带窗口的 App（`@opencode-aidesktop`）

Desktop 1.18 不支持“往聊天界面里插入面板”的插件；所以本项目的 Server 插件会在本机起一个 `http://127.0.0.1:4791` 的小网页，用 `retc-panel.cmd` 打开成独立窗口，放在 OpenCode 旁边即可。译文由插件推送，和聊天同步流式更新。

## 安装

```powershell
git clone https://github.com/heyuan29171/retc-opencode-reasoning-translator.git D:\code\program\retc-opencode-reasoning-translator
```

在 `~/.config/opencode/opencode.json` 的 `plugin` 数组里加**目录路径**（Server 插件）：

```json
{
  "plugin": ["D:/code/program/retc-opencode-reasoning-translator"]
}
```

完全退出并重新打开 OpenCode。

想固定翻译模型（默认跟随当前会话选中的模型）：

```json
{
  "plugin": [
    ["D:/code/program/retc-opencode-reasoning-translator", { "model": "opencode-go/deepseek-v4.1-flash" }]
  ]
}
```

可选参数：`port`（默认 4791）、`inline`（默认 true，是否同时写回思考块）、`panel`（默认 true，是否启动侧边面板）。

## 打开侧边面板

双击 `retc-panel.cmd`，或：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File D:\code\program\retc-opencode-reasoning-translator\retc-panel.ps1
```

- 用 Edge 的 app 模式打开一个 460×940 的窗口，自动贴在屏幕右侧并置顶
- 不想置顶：加 `-NoTopMost`；换端口：`-Port 4800`
- 直接浏览器打开 `http://127.0.0.1:4791/` 也可以

## 终端 TUI

`~/.config/opencode/tui.json`：

```json
{
  "plugin": ["D:/code/program/retc-opencode-reasoning-translator/src/tui.tsx"]
}
```

右侧栏出现「思考译文」；点击「思考译文 模型名 ▾」弹出模型选择框（所有已配置模型，按 provider 分组），也可用 `/retc-model`。

## 工作原理

Server 插件：

```
reasoning part 每次更新（还没结束也能翻）
  → 按句子/段落切块（≥120 字符）
  → 用会话当前模型流式翻译
  → SSE 推送到 http://127.0.0.1:4791 的侧边面板
  → 思考结束后，把完整译文一次性写回 reasoning part（【中文翻译】）
  → 下一次请求前，experimental.chat.messages.transform 把译文剥掉
```

写回思考块的译文只用于显示，**发回模型前会删除**，不会多花后续 token。

TUI 插件：按句切块、2 路并发、按原顺序显示在右侧栏。

## 注意

- 侧边面板同一时间只能被一个 OpenCode 实例占用（默认端口 4791）
- 每次翻译都会消耗所选模型的额度
- 后台子 agent 的思考也会翻译

## 排错

设置 `RETC_DEBUG=1` 后重启，日志写到 `%TEMP%\retc.log`。

## License

MIT
