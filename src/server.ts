import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DEFAULT_MODEL, translate, type ModelRef } from "./translate"

const MARK = "【中文翻译】"
const STRIP = /\n*【中文翻译】\n[\s\S]*$/

function log(text: string) {
  if (!process.env.RETC_DEBUG) return
  try {
    fs.appendFileSync(path.join(os.tmpdir(), "retc.log"), `${new Date().toISOString()} ${text}\n`)
  } catch {}
}

type Target = {
  providerID: string
  modelID: string
}

export const plugin: Plugin = async ({ client }, options) => {
  const sessionModel = new Map<string, Target>()
  const queues = new Map<string, Promise<void>>()
  const done = new Set<string>()
  let providers: any[] | null = null

  const forced = typeof options?.model === "string" && options.model.includes("/") ? options.model : undefined

  const catalog = async () => {
    if (providers) return providers
    try {
      const res: any = await client.config.providers()
      providers = res?.data?.providers ?? []
    } catch {
      providers = []
    }
    return providers
  }

  const refFor = async (target: Target): Promise<ModelRef | null> => {
    const all = await catalog()
    const provider = all.find((item: any) => item.id === target.providerID)
    const model = provider && provider.models ? provider.models[target.modelID] : undefined
    if (!provider || !model) return null
    return {
      providerID: provider.id,
      providerName: provider.name,
      modelID: target.modelID,
      apiID: (model.api && model.api.id) || target.modelID,
      apiUrl: (model.api && model.api.url) || "",
      apiNpm: (model.api && model.api.npm) || "",
      name: model.name || target.modelID,
      env: provider.env || [],
    }
  }

  const chosen = async (sessionID: string): Promise<ModelRef | null> => {
    if (forced) {
      const [providerID, ...rest] = forced.split("/")
      const hit = await refFor({ providerID, modelID: rest.join("/") })
      if (hit) return hit
    }
    const current = sessionModel.get(sessionID)
    if (current) {
      const hit = await refFor(current)
      if (hit) return hit
    }
    const [providerID, ...rest] = DEFAULT_MODEL.split("/")
    return refFor({ providerID, modelID: rest.join("/") })
  }

  const pieces = (text: string) => {
    const out: string[] = []
    let rest = text.slice(0, 30000)
    while (rest.length) {
      if (rest.length <= 1600) {
        out.push(rest)
        break
      }
      let cut = rest.lastIndexOf("\n\n", 1600)
      if (cut < 500) cut = rest.lastIndexOf("\n", 1600)
      if (cut < 500) cut = rest.lastIndexOf(". ", 1600)
      if (cut < 500) cut = 1600
      out.push(rest.slice(0, cut + 1))
      rest = rest.slice(cut + 1)
    }
    return out
  }

  const write = async (part: any, text: string) => {
    const api: any = client as any
    const body = { ...part, text }
    if (api.part && typeof api.part.update === "function") {
      await api.part.update({
        path: { sessionID: part.sessionID, messageID: part.messageID, partID: part.id },
        body,
      })
      return
    }
    if (api._client && typeof api._client.patch === "function") {
      await api._client.patch({
        url: `/session/${part.sessionID}/message/${part.messageID}/part/${part.id}`,
        body,
      })
      return
    }
    throw new Error("当前版本不支持更新消息 part")
  }

  return {
    "chat.params": async (input) => {
      if (input.model) sessionModel.set(input.sessionID, { providerID: input.model.providerID, modelID: input.model.id })
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      let stripped = 0
      for (const message of output.messages as any[]) {
        const parts = message && message.parts
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          if ((part.type === "reasoning" || part.type === "text") && typeof part.text === "string" && part.text.includes(MARK)) {
            part.text = part.text.replace(STRIP, "")
            stripped += 1
          }
        }
      }
      if (stripped) log(`stripped ${stripped} translated part(s) before request`)
    },
    event: async ({ event }) => {
      if (event.type !== "message.part.updated") return
      const part: any = (event as any).properties?.part
      if (!part || part.type !== "reasoning" || typeof part.text !== "string" || !part.text) return
      if (!part.time || !part.time.end) return
      if (done.has(part.id) || part.text.includes(MARK)) return
      if (!/[A-Za-z]{3}/.test(part.text)) return
      done.add(part.id)
      const sid = part.sessionID
      const chain = queues.get(sid) ?? Promise.resolve()
      const next = chain.then(async () => {
        try {
          const ref = await chosen(sid)
          if (!ref) throw new Error("没有可用的翻译模型")
          let zh = ""
          for (const piece of pieces(part.text)) {
            const out = await translate(ref, piece, "", () => {})
            if (!out.trim()) continue
            zh = zh ? zh + "\n" + out : out
            await write(part, part.text + "\n\n" + MARK + "\n" + zh)
          }
        } catch (error) {
          log("server error: " + String(error instanceof Error ? error.message : error))
        }
      })
      queues.set(sid, next)
    },
  }
}

export default { id: "retc", server: plugin }
