import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

export type Health = "idle" | "translating" | "error"

export type View = {
  zh: string
  preview: string
  health: Health
  note: string
}

export type ModelRef = {
  providerID: string
  providerName: string
  modelID: string
  apiID: string
  apiUrl: string
  apiNpm: string
  name: string
  env: string[]
}

export type ModelChoice = {
  value: string
  label: string
  provider: string
  supported: boolean
  ref: ModelRef
}

export const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash"
export const KV_KEY = "retc.model"

const AUTH = path.join(os.homedir(), ".local", "share", "opencode", "auth.json")

const SYSTEM = [
  "You translate an AI coding assistant's private reasoning into Simplified Chinese.",
  "Rules:",
  "1. Output only the Chinese translation, with no preamble, quotes, or notes.",
  "2. Keep code, file paths, commands, identifiers, URLs, numbers and Markdown syntax unchanged.",
  "3. Keep the original paragraph breaks roughly.",
  "4. If the input is already Chinese, return it unchanged.",
].join("\n")

const OPENAI_COMPATIBLE = [
  "openai",
  "deepseek",
  "xai",
  "groq",
  "mistral",
  "cerebras",
  "zhipu",
  "alibaba",
  "moonshot",
  "togetherai",
  "openrouter",
  "ollama",
  "opencode",
]

export function supported(ref: ModelRef) {
  const npm = (ref.apiNpm || "").toLowerCase()
  if (!(ref.apiUrl || "").trim()) return false
  if (!npm) return true
  if (npm.includes("anthropic") || npm.includes("google") || npm.includes("bedrock") || npm.includes("vertex")) return false
  return OPENAI_COMPATIBLE.some((item) => npm.includes(item))
}

export function endpoint(ref: ModelRef) {
  const url = (ref.apiUrl || "").replace(/\/+$/, "")
  if (!url) return ""
  if (url.endsWith("/chat/completions")) return url
  return url + "/chat/completions"
}

export function authKey(ref: ModelRef) {
  const names = ref.env && ref.env.length ? ref.env : []
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  try {
    const json = JSON.parse(fs.readFileSync(AUTH, "utf8"))
    const item = json ? json[ref.providerID] : undefined
    if (item && typeof item.key === "string" && item.key.trim()) return item.key.trim()
  } catch {}
  return ""
}

function headers(ref: ModelRef, token: string) {
  const out: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
  }
  if (token) out.authorization = `Bearer ${token}`
  if (ref.providerID === "opencode-go" || ref.providerID === "opencode" || /opencode\.ai\/zen/.test(ref.apiUrl)) {
    out["x-opencode-session"] = "ses_" + randomUUID().replace(/-/g, "")
  }
  return out
}

function payload(ref: ModelRef, text: string, context: string, stream: boolean) {
  return {
    model: ref.apiID || ref.modelID,
    temperature: 0.1,
    stream,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: context
          ? `Earlier English context (reference only, do not translate):\n${context}\n\nTranslate this part into Simplified Chinese:\n${text}`
          : text,
      },
    ],
  }
}

export async function translate(
  ref: ModelRef,
  text: string,
  context: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  if (!supported(ref)) throw new Error(`${ref.providerName} 的接口协议暂不支持`)
  const url = endpoint(ref)
  if (!url) throw new Error("模型缺少接口地址")
  const token = authKey(ref)
  const res = await fetch(url, {
    method: "POST",
    headers: headers(ref, token),
    body: JSON.stringify(payload(ref, text, context, true)),
    signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}${detail ? " " + detail.slice(0, 120) : ""}`)
  }
  const type = res.headers.get("content-type") || ""
  if (!res.body || !type.includes("event-stream")) {
    const data: any = await res.json()
    const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (typeof out !== "string" || !out.trim()) throw new Error("模型返回空内容")
    onDelta(out.trim())
    return out.trim()
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let out = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf("\n")
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim()
        if (raw && raw !== "[DONE]") {
          try {
            const json = JSON.parse(raw)
            const choice = json && json.choices && json.choices[0]
            const delta = choice && choice.delta ? choice.delta.content : undefined
            if (typeof delta === "string" && delta) {
              out += delta
              onDelta(out)
            }
          } catch {}
        }
      }
      index = buffer.indexOf("\n")
    }
  }
  if (!out.trim()) throw new Error("模型返回空内容")
  return out.trim()
}
