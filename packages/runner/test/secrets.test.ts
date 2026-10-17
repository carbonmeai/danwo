import { once } from "node:events"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { listeningPort } from "@danwo/emulators"
import { MockLanguageModelV4 } from "ai/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession } from "../src/session.ts"

const PASSWORD = "correct-horse-battery-staple-7"

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function toolCall(toolName: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `call-${toolName}-${Math.random()}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  }
}

function promptText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(promptText).join("\n")
  if (value && typeof value === "object") return Object.values(value).map(promptText).join("\n")

  return ""
}

/** Signs in: types the email, fills the password secret by name, clicks Sign in, ends the step. */
function signInActor(): MockLanguageModelV4 & { prompts: string[] } {
  const prompts: string[] = []
  const used = (options: LanguageModelV4CallOptions, tool: string) =>
    options.prompt.some(
      (m) =>
        m.role === "tool" && m.content.some((part) => "toolName" in part && part.toolName === tool),
    )
  const node = (text: string, role: string, name: string) =>
    new RegExp(`- ${role} "${name}"[^\\n]*?\\[ref=([a-z0-9]+)\\]`).exec(text)?.[1]
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "sign-in-actor",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const text = promptText(options.prompt)

      prompts.push(text)
      if (used(options, "click"))
        return toolCall("done", { status: "passed", summary: "signed in" })
      if (used(options, "fill_secret"))
        return toolCall("click", { ref: node(text, "button", "Sign in") })
      if (used(options, "fill"))
        return toolCall("fill_secret", {
          ref: node(text, "textbox", "Password"),
          secret: "password",
        })

      return toolCall("fill", { ref: node(text, "textbox", "Email"), text: "qa@danwo.test" })
    },
  })

  return Object.assign(model, { prompts })
}

const received: Array<{ email: string; password: string }> = []
let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "POST") {
      let body = ""

      req.on("data", (chunk: Buffer) => (body += chunk.toString()))
      req.on("end", () => {
        const form = new URLSearchParams(body)

        received.push({ email: form.get("email") ?? "", password: form.get("password") ?? "" })
        res.writeHead(200, { "content-type": "text/html" })
        res.end(
          `<!doctype html><title>Home</title><h1>Signed in as ${form.get("email") ?? ""}</h1>`,
        )
      })

      return
    }

    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html><title>Sign in</title><form method="post">
      <label>Email <input name="email" type="email"></label>
      <label>Password <input name="password" type="password"></label>
      <button type="submit">Sign in</button></form>`)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
})

afterAll(() => {
  server.close()
})

describe("secrets", () => {
  it("fills a secret the model only knows by name, and keeps it out of prompts and the cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-secrets-"))

    try {
      received.length = 0
      const actor = signInActor()
      const first = await openWebSession({
        baseUrl,
        model: actor,
        secrets: { password: { value: PASSWORD, purpose: "password" } },
        cache: { dir, mode: "read-write", journey: "secrets" },
      })

      try {
        await first.app.open("/")
        await first.agent.act("sign in as {email} with password {password}", {
          params: { email: "qa@danwo.test", password: first.secret("password") },
        })
        await first
          .expect(first.screen.getByRole("heading", { name: "Signed in as qa@danwo.test" }))
          .toBeVisible()
      } finally {
        await first.close()
      }

      expect(received).toEqual([{ email: "qa@danwo.test", password: PASSWORD }])
      expect(actor.prompts.length).toBeGreaterThan(0)
      expect(actor.prompts.some((prompt) => prompt.includes(PASSWORD))).toBe(false)

      const files = await readdir(dir)

      expect(files.length).toBe(1)
      const entry = await readFile(join(dir, files[0]!), "utf8")

      expect(entry).not.toContain(PASSWORD)
      expect(entry).toContain('"secret": "password"')

      // A replay fills the secret again from the session, with no model call.
      received.length = 0
      const replayActor = signInActor()
      const second = await openWebSession({
        baseUrl,
        model: replayActor,
        secrets: { password: { value: PASSWORD, purpose: "password" } },
        cache: { dir, mode: "read-only", journey: "secrets" },
      })

      try {
        await second.app.open("/")
        await second.agent.act("sign in as {email} with password {password}", {
          params: { email: "qa@danwo.test", password: second.secret("password") },
        })
        await second
          .expect(second.screen.getByRole("heading", { name: "Signed in as qa@danwo.test" }))
          .toBeVisible()
      } finally {
        await second.close()
      }

      expect(replayActor.doGenerateCalls.length).toBe(0)
      expect(received).toEqual([{ email: "qa@danwo.test", password: PASSWORD }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("fills a secret through a locator without the agent", async () => {
    received.length = 0
    const session = await openWebSession({
      baseUrl,
      secrets: { password: { value: PASSWORD, purpose: "password" } },
    })

    try {
      await session.app.open("/")
      await session.screen.getByLabel("Email").fill("qa@danwo.test")
      await session.screen.getByLabel("Password").fill(session.secret("password"))
      await session.screen.getByRole("button", { name: "Sign in" }).click()
      await session
        .expect(session.screen.getByRole("heading", { name: "Signed in as qa@danwo.test" }))
        .toBeVisible()
    } finally {
      await session.close()
    }

    expect(received).toEqual([{ email: "qa@danwo.test", password: PASSWORD }])
  }, 60_000)

  it("refuses an unknown secret name", async () => {
    const session = await openWebSession({ baseUrl })

    try {
      expect(() => session.secret("missing")).toThrow(/not in this session's secrets/)
    } finally {
      await session.close()
    }
  }, 60_000)
})
