/** Pieces every provider's answer is built from: ids, text split into stream deltas, SSE framing. */
import { randomBytes } from "node:crypto"

import type { LlmReply } from "./entities.ts"

/** A provider-style id: `prefix` and random letters and digits. */
export function llmId(prefix: string): string {
  return prefix + randomBytes(12).toString("base64url").replace(/[-_]/g, "x")
}

/** The text a reply's message carries: its text, or its structured object as JSON. */
export function messageText(reply: LlmReply): string {
  if (reply.text !== undefined) return reply.text

  return reply.json === undefined ? "" : JSON.stringify(reply.json)
}

/** `text` in the pieces a stream sends it in, about a few words each. */
export function deltas(text: string): string[] {
  return text.match(/.{1,16}/gs) ?? []
}

/** One server-sent event; named events carry an `event:` line. */
export function sse(data: unknown, event?: string): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data)

  return `${event === undefined ? "" : `event: ${event}\n`}data: ${payload}\n\n`
}

/**
 * A stream's events as one response body. A stream cut short keeps only its first half, with
 * nothing that ends it, as when a connection drops mid-answer.
 */
export function eventStream(events: readonly string[], cut: boolean): Response {
  const kept = cut ? events.slice(0, Math.max(1, Math.floor(events.length / 2))) : events

  return new Response(kept.join(""), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
  })
}

/** A JSON body that breaks off half-way, as a non-streamed answer cut short arrives. */
export function cutJson(value: unknown): Response {
  const text = JSON.stringify(value)

  return new Response(text.slice(0, Math.floor(text.length / 2)), {
    headers: { "content-type": "application/json" },
  })
}

/** Seconds since the epoch, as OpenAI's `created` fields are. */
export function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}
