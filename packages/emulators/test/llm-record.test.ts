import { once } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createEmulator } from "../src/define.ts"
import { llm, llmCalls, seedLlm } from "../src/llm/index.ts"
import { listeningPort } from "../src/net.ts"
import { openaiClient } from "./llm-client.ts"

const REAL_KEY = "REDACTED-TEST-VALUE"

/** What the stand-in for the real provider was asked. */
interface Asked {
  readonly authorization: string
  readonly body: Record<string, unknown>
}

const asked: Asked[] = []
let upstream: Server
let upstreamUrl: string
let dir: string

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ""

  for await (const chunk of req) text += String(chunk)

  const parsed: unknown = JSON.parse(text)

  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {}
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-llm-record-"))
  upstream = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      asked.push({ authorization: req.headers.authorization ?? "", body })
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          id: "chatcmpl-real",
          object: "chat.completion",
          created: 0,
          model: "gpt-5-mini",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Paris is the capital of France.",
                refusal: null,
              },
              finish_reason: "stop",
              logprobs: null,
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 },
        }),
      )
    })
  })
  upstream.listen(0, "127.0.0.1")
  await once(upstream, "listening")
  upstreamUrl = `http://127.0.0.1:${listeningPort(upstream)}`
})

afterAll(async () => {
  upstream.close()
  await rm(dir, { recursive: true, force: true })
})

describe("recording", () => {
  it("asks the real provider once with the user's key, saves the answer without it, then replays it", async () => {
    const file = join(dir, "llm-scripts.json")
    const recording = createEmulator(llm)

    seedLlm(recording.store, {
      unscripted: "fail",
      record: { file, keys: { openai: REAL_KEY }, upstreams: { openai: upstreamUrl } },
    })

    const ask = (emulator: typeof recording) =>
      openaiClient(emulator).chat.completions.create({
        model: "gpt-5-mini",
        stream: true,
        messages: [{ role: "user", content: "What is the capital of France?" }],
      })
    let first = ""

    for await (const chunk of await ask(recording)) first += chunk.choices[0]?.delta.content ?? ""

    expect(first).toBe("Paris is the capital of France.")
    expect(asked).toHaveLength(1)
    expect(asked[0]?.authorization).toBe(`Bearer ${REAL_KEY}`)
    expect(asked[0]?.body.stream).toBeUndefined()

    const saved = await readFile(file, "utf8")

    expect(saved).toContain("Paris is the capital of France.")
    expect(saved).not.toContain("USERSOWNREALKEY")
    expect(JSON.stringify(recording.snapshot())).not.toContain("USERSOWNREALKEY")

    const replaying = createEmulator(llm)

    seedLlm(replaying.store, { unscripted: "fail", record: { file } })

    let again = ""

    for await (const chunk of await ask(replaying)) again += chunk.choices[0]?.delta.content ?? ""

    expect(again).toBe("Paris is the capital of France.")
    expect(asked).toHaveLength(1)
    expect(llmCalls(replaying).last()?.script).toBe("recorded gpt-5-mini")
  })
})
