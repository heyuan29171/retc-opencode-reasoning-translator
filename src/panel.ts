export type PanelEvent = {
  sid: string
  part: string
  zh: string
  status: "idle" | "live" | "done" | "error"
  model?: string
  note?: string
}

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>retc</title>
<style>
:root{color-scheme:dark}
html,body{margin:0;height:100%;background:#0b0b0c;color:#e6e6e6;font:14px/1.75 "Segoe UI","Microsoft YaHei",sans-serif}
#wrap{display:flex;flex-direction:column;height:100%}
header{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #232326;font-size:12px;color:#8a8a8f}
#dot{width:8px;height:8px;border-radius:50%;background:#666;flex:none}
.live #dot{background:#5f87ff;animation:p 1s infinite}
.done #dot{background:#4caf50}
.error #dot{background:#e05d5d}
@keyframes p{50%{opacity:.25}}
#text{flex:1;overflow:auto;padding:14px 16px;white-space:pre-wrap;word-break:break-word;font-size:14.5px}
#empty{color:#6b6b70}
</style></head>
<body class="idle"><div id="wrap">
<header><span id="dot"></span><span id="model">retc · 中文思考</span><span id="status" style="margin-left:auto"></span></header>
<div id="text"><span id="empty">等待思考…</span></div>
</div>
<script>
const box=document.getElementById("text"),empty=document.getElementById("empty"),status=document.getElementById("status"),model=document.getElementById("model");
let part="",stick=true;
box.addEventListener("scroll",()=>{stick=box.scrollTop+box.clientHeight>=box.scrollHeight-30});
function render(d){
  document.body.className=d.status||"idle";
  model.textContent=d.model?"retc · "+d.model:"retc · 中文思考";
  status.textContent=d.status==="live"?"翻译中…":d.status==="done"?"完成":d.status==="error"?"失败 "+(d.note||""):"";
  if(d.part!==part){part=d.part;box.textContent=""}
  if(d.zh){if(empty.parentNode)empty.remove();box.textContent=d.zh;if(stick)box.scrollTop=box.scrollHeight}
  else if(d.status==="error"){box.textContent=d.note||"翻译失败"}
  else if(!box.textContent){box.textContent="思考中…"}
}
const es=new EventSource("/events");
es.onmessage=(e)=>{try{render(JSON.parse(e.data))}catch{}};
es.onerror=()=>{status.textContent="面板重连中…"};
</script></body></html>`

export function createPanel(port: number) {
  const Bun = (globalThis as any).Bun
  if (!Bun || typeof Bun.serve !== "function") return null
  const clients = new Set<any>()
  let latest: PanelEvent | null = null
  let server: any
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req: Request) {
        const url = new URL(req.url)
        if (url.pathname === "/health") return new Response("ok")
        if (url.pathname === "/events") {
          const stream = new ReadableStream({
            start(ctrl) {
              if (latest) ctrl.enqueue(`data: ${JSON.stringify(latest)}\n\n`)
              clients.add(ctrl)
              req.signal.addEventListener("abort", () => clients.delete(ctrl))
            },
          })
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache, no-transform",
              connection: "keep-alive",
            },
          })
        }
        return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } })
      },
    })
  } catch {
    return null
  }
  return {
    port: server.port,
    push(event: PanelEvent) {
      latest = event
      const line = `data: ${JSON.stringify(event)}\n\n`
      for (const client of clients) {
        try {
          client.enqueue(line)
        } catch {
          clients.delete(client)
        }
      }
    },
    close() {
      try {
        server.stop(true)
      } catch {}
    },
  }
}
