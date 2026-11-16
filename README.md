# retc — reasoning english to chinese

把模型的**英文思考过程（reasoning）**实时翻译成中文，**直接显示在 OpenCode 聊天里**。

- 模型开始思考后，思考块下面会多出一个「【思考译文】」块，边翻边补，不用等回答结束
- 位置在思考块和正文之间，Desktop / TUI 都能看到
- 不需要额外窗口、不需要切换界面
- 译文只用于显示：**每次请求前会自动从上下文里删掉**，不增加 token

## 安装

```powershell
git clone https://github.com/heyuan29171/retc-opencode-reasoning-translator.git D:\code\program\retc-opencode-reasoning-translator
```

在 `~/.config/opencode/opencode.json` 的 `plugin` 数组里加**目录路径**：

```json
{
  "plugin": ["D:/code/program/retc-opencode-reasoning-translator"]
}
```

完全退出并重新打开 OpenCode。之后随便聊一句，带思考的回复里就会出现【思考译文】。

## 配置

翻译默认使用**当前会话选中的模型**（你在界面里换模型，翻译跟着换）。也可以固定：

```json
{
  "plugin": [
    [
      "D:/code/program/retc-opencode-reasoning-translator",
      {
        "model": "opencode-go/deepseek-v4.1-flash"
      }
    ]
  ]
}
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `model` | 跟随会话 | `provider/model` 格式，固定翻译模型 |
| `inline` | `true` | 是否在聊天里插入【思考译文】块 |
| `panel` | `false` | 可选：额外起一个本地网页面板（见下） |
| `port` | `4791` | `panel: true` 时的端口 |

## 可选：侧边网页面板

默认**关闭**。如果你另外想要一个小窗口：

```json
{ "plugin": [["D:/code/program/retc-opencode-reasoning-translator", { "panel": true }]] }
```

然后双击 `retc-panel.cmd`，或直接打开 `http://127.0.0.1:4791/`。

## 终端 TUI

`~/.config/opencode/tui.json`：

```json
{
  "plugin": ["D:/code/program/retc-opencode-reasoning-translator/src/tui.tsx"]
}
```

右侧栏内嵌流式译文，点击标题可切换翻译模型。

## 工作原理

```
reasoning part 开始
  → 立即在同一个 assistant message 里插入一个 text part
    （id = reasoning part id + "0"，所以排序刚好在思考块后面）
  → reasoning 流式更新时按句子切块翻译
  → 每 400ms 更新一次这个 text part，看起来就是流式输出
  → 请求前：experimental.chat.messages.transform 删除带 metadata.retc 的 part
```

译文块带 `metadata.retc = true`，只用于显示；不会进入模型上下文，也不会改变思考内容本身。

## 注意

- 每次翻译都会消耗所选模型的额度
- 后台子 agent 的思考也会翻译（每个子会话独立）
- 如果模型不支持把 reasoning 暴露出来，就没有可翻译的内容

## 排错

设置 `RETC_DEBUG=1` 后重启，日志写到 `%TEMP%\retc.log`。

## License

MIT
