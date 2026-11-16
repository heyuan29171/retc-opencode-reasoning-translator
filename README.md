# retc — reasoning english to chinese

给 [OpenCode](https://opencode.ai) TUI 用的插件：把模型**英文思考过程（reasoning）**实时翻译成中文，显示在右侧栏，并且可以点击标题切换翻译模型。

- 只翻译 `type: "reasoning"` 的 part，不动助手正文
- **不修改会话内容**：不会写回 reasoning，不影响上下文和 token
- 流式翻译：按句子/段落切块，最多 2 个请求并发，按原顺序拼接
- 首字大约 0.8–1.5 秒出现，之后随思考持续追加（取决于所选模型速度）
- 翻译请求直接走你已配置的 provider，不需要额外进程或本地模型
- 点击侧栏「思考译文 ▾」弹出模型选择框，列出所有已配置模型；也可用命令面板 / 斜杠命令 `retc-model`

## 环境要求

- OpenCode `>= 1.19.0`
- 一个 OpenAI Chat Completions 兼容的 provider（`opencode-go`、`opencode`、`deepseek`、`zhipuai`、`ollama`、`openrouter` 等）
- provider 的凭据已经通过 `opencode auth` / `opencode.json` 配好

## 安装（本地）

```powershell
git clone https://github.com/heyuan29171/retc-opencode-reasoning-translator.git D:\code\program\retc-opencode-reasoning-translator
```

在 `~/.config/opencode/tui.json` 里加一条：

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["D:/code/program/retc-opencode-reasoning-translator/src/tui.tsx"]
}
```

重启 OpenCode，会话右侧栏出现的「思考译文」就是它。

关闭插件：

```json
{
  "plugin": [["D:/code/program/retc-opencode-reasoning-translator/src/tui.tsx", { "enabled": false }]]
}
```

## 选择模型

默认是 `opencode-go/deepseek-v4.1-flash`。三种切换方式：

1. 点击侧栏「思考译文 deepseek-v4.1-flash ▾」
2. 命令面板里找 `Retc: 选择思考翻译模型`
3. 斜杠命令 `/retc-model`

选择结果保存在 TUI 的 KV（`retc.model`），重启后保留。协议不是 OpenAI 兼容的模型（如 Anthropic / Google）会显示为不可选。

## 工作原理

```
reasoning part 流式更新
  → 按句子边界切片（约 100–1200 字符）
  → 并发 2 路请求所选模型翻译（SSE）
  → 按原顺序提交到侧栏
```

- 只处理当前打开会话的 reasoning，后台子 agent 不会消耗额度
- 翻译失败时侧栏显示错误原因，英文思考仍保留在对话里；下一条消息会重试
- 每条翻译请求都会消耗所选模型额度

## 排错

设置环境变量 `RETC_DEBUG=1` 后重启 OpenCode，日志写到 `%TEMP%\retc.log`。

## License

MIT
