# retc — reasoning english to chinese

OpenCode **Desktop** 的 GUI 插件：把模型的**英文思考过程（reasoning）**实时翻译成简体中文，显示在会话右侧的独立面板里。

- 侧栏面板「思考译文」，淡金色排版，和正文明显分开
- 边思考边翻译：服务端订阅 `session.reasoning.*` 事件，按句切块翻译后推给面板
- 面板顶部可切换翻译模型（列出所有已配置模型）
- **完全不写会话消息**：零上下文占用，压缩/摘要也不会有残留
- 不弹额外窗口，不修改 OpenCode 本体

## 环境要求

- OpenCode **Desktop 2.2.0+**（桌面插件 API；在 2.3.0 上开发）
- Node.js 22+（只用于构建 GUI 包）

## 安装

```powershell
git clone https://github.com/heyuan29171/retc-opencode-reasoning-translator.git D:\code\program\retc-opencode-reasoning-translator
cd D:\code\program\retc-opencode-reasoning-translator
npm install
npm run build
```

在 `~/.config/opencode/opencode.json` 里加：

```json
{
  "plugins": ["D:/code/program/retc-opencode-reasoning-translator"]
}
```

**完全退出并重新打开 OpenCode Desktop**。进入会话后，右侧面板会多一个「思考译文」标签；也可以从侧栏 `+` 菜单或命令面板 `retc: 思考译文` 打开。

## 使用

- 默认翻译模型：`opencode-go/deepseek-v4.1-flash`
- 面板右上角的下拉框可以换成任意已配置模型，选择会保存在插件自己的 storage 里
- 翻译失败时状态点变红，内容区显示「等待思考…」；下一条思考会重新尝试

## 工作原理

```
server 部分（@opencode/plugin）
  session.reasoning.started / delta / ended
    → 按句切块（≥120 字符）
    → ctx.experimental.generate.text() 逐块翻译
    → RPC 事件 reasoning 推给 GUI

GUI 部分（./gui-experimental，Vite 打包）
  Panel（侧栏）+ Style（淡金 CSS）
    → 订阅 RPC 事件，按 session 过滤
    → 流式渲染，自动滚动
```

整个流程只读事件，不写消息、不碰会话内容。

## 开发

```powershell
npm run watch
npm run typecheck
```

- GUI 改动：本地目录的 `./gui-experimental` 重新构建后，Desktop 会重新加载 GUI
- server 改动：需要重启 OpenCode Desktop

## 排错

- 插件没加载：看 OpenCode 日志里的 `loading plugin` / `failed to load plugin`
- 面板没有译文：确认当前模型会产出 reasoning；确认 provider 有可用额度
- GUI 改完没生效：重新 `npm run build`，必要时重启 Desktop

## License

MIT
