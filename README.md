# retc — reasoning english to chinese

把模型**英文思考过程（reasoning）**翻译成简体中文，在 OpenCode 里直接看。

两种形态，同一个仓库：

| 形态 | 适用 | 效果 |
| --- | --- | --- |
| **Server 插件** | OpenCode **Desktop**、`opencode run`、TUI | 在思考块末尾追加「【中文翻译】」，写着写着逐步补齐 |
| **TUI 插件** | 终端 `opencode` | 右侧栏实时显示译文，点击标题可切换翻译模型 |

Server 插件会先把译文从发回模型的上下文里剥掉，**不会增加后续对话的 token**，也不会污染会话内容（译文只存在 reasoning 文本里，发送前自动移除）。

## 环境要求

- OpenCode `>= 1.19.0`（Desktop 版自带的 server 同样是 1.19+ 即可）
- 已配置的 provider：翻译沿用**当前会话选中的模型**，所以 `opencode-go`、`opencode`、`deepseek`、`zhipuai`、`ollama`、`openrouter` 等 OpenAI 兼容接口都行

## 安装

```powershell
git clone https://github.com/heyuan29171/retc-opencode-reasoning-translator.git D:\code\program\retc-opencode-reasoning-translator
```

### Desktop（推荐）

在 `~/.config/opencode/opencode.json` 的 `plugin` 数组里加**目录路径**：

```json
{
  "plugin": ["D:/code/program/retc-opencode-reasoning-translator"]
}
```

保存后**完全退出并重新打开 OpenCode Desktop**（它会重启自带的 server）。

之后每次模型思考结束，思考块里会出现：

```
The user wants ...
【中文翻译】
用户想要……
```

翻译使用你当前会话选中的模型——直接在界面里换模型，翻译跟着换，不需要额外选择器（Desktop 1.18 没有插件 UI 钩子，无法在聊天界面里塞自定义弹窗）。

想固定用某个模型，不跟随会话：

```json
{
  "plugin": [
    ["D:/code/program/retc-opencode-reasoning-translator", { "model": "opencode-go/deepseek-v4.1-flash" }]
  ]
}
```

### 终端 TUI

`~/.config/opencode/tui.json`：

```json
{
  "plugin": ["D:/code/program/retc-opencode-reasoning-translator/src/tui.tsx"]
}
```

右侧栏出现「思考译文」，流式显示；点击「思考译文 模型名 ▾」弹出模型选择框（所有已配置模型，按 provider 分组），也可用 `/retc-model`。所选模型存在 TUI KV（`retc.model`）。

## 工作原理

Server 插件：

```
reasoning part 结束（time.end）
  → 按 1.6k 字符切块
  → 用会话当前模型逐块翻译
  → 每翻完一块就 PATCH 该 reasoning part：原文 + 【中文翻译】 + 已翻译部分
  → 下一次请求前，experimental.chat.messages.transform 把【中文翻译】之后的文本剥掉
```

TUI 插件：

```
reasoning part 流式更新
  → 按句子切块、2 路并发
  → 按原顺序提交到右侧栏
```

## 注意

- 译文写在 reasoning part 里，所以需要展开思考块才能看到
- 每次翻译都会消耗所选模型的额度；长思考会分多次请求
- 后台子 agent 的思考也会翻译

## 排错

设置 `RETC_DEBUG=1` 后重启，日志写到 `%TEMP%\retc.log`。

## License

MIT
