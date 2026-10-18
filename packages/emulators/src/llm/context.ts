/** What every model API route shares: the body as an object, and sending whole or streamed. */
import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import { asRecord } from "../json.ts"
import type { Answered } from "./answer.ts"
import type { LlmProvider } from "./entities.ts"
import { providerOf } from "./helpers.ts"
import { cutJson, eventStream } from "./wire.ts"

/** The request body as a JSON object, or a 400. */
export async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const body = asRecord(await c.req.json().catch(() => undefined))

  if (body === undefined) throw new HttpError(400, "the request body must be a JSON object")

  return body
}

/** Refuses a route asked of another provider's host, as the real host would not know it. */
export function onlyFor(c: Context, provider: LlmProvider): void {
  if (providerOf(c) !== provider) throw new HttpError(404, `no such route on this host`)
}

/**
 * Sends an answer: as a stream of events when the call streams, else whole. A `stream-cut` fault
 * cuts either short.
 */
export function send(
  c: Context,
  answered: Answered,
  stream: boolean,
  whole: unknown,
  events: () => string[],
): Response {
  const cut = answered.behaviour === "stream-cut"

  if (stream) return eventStream(events(), cut)

  return cut ? cutJson(whole) : c.json(whole)
}
