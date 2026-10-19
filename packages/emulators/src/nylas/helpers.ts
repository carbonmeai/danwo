import { randomBytes, randomUUID } from "node:crypto"

import type { App, Context } from "../http.ts"
import { asRecord } from "../json.ts"
import type { Clock, Store } from "../store.ts"
import type { NylasEmailName } from "./entities.ts"
import type { NylasEvents } from "./events.ts"
import type { NylasStore } from "./store.ts"

/** The hosts the Nylas emulator answers: the US and EU API regions. */
export const NYLAS_HOSTS: readonly string[] = ["api.us.nylas.com", "api.eu.nylas.com"]

/** What every group of Nylas routes is registered with. */
export interface NylasRouteContext {
  readonly app: App
  readonly objects: NylasStore
  readonly events: NylasEvents
  readonly clock: Clock
  /** The raw store: the backend emulators this one is connected to are kept against it. */
  readonly store: Store
}

/** A failure answered in Nylas's error envelope. */
export class NylasError extends Error {
  readonly status: number
  readonly type: string

  constructor(status: number, type: string, message: string) {
    super(message)
    this.name = "NylasError"
    this.status = status
    this.type = type
  }
}

export const notFound = (what: string) =>
  new NylasError(404, "not_found_error", `${what} not found`)

export const badRequest = (message: string) => new NylasError(400, "invalid_request_error", message)

/** A request id, as every answer carries one. */
export const requestId = () => randomUUID()

/** Nylas's error envelope, as the SDK reads it into a `NylasApiError`. */
export function nylasError(c: Context, status: number, type: string, message: string): Response {
  return c.json({ request_id: requestId(), error: { type, message } }, status)
}

/** One object in Nylas's answer envelope. */
export function one(c: Context, data: unknown, status = 200): Response {
  return c.json({ request_id: requestId(), data }, status)
}

/** Unix seconds of `clock`'s time. */
export function seconds(clock: Clock): number {
  return Math.floor(clock().getTime() / 1000)
}

/** A provider-style message, thread or event id: 16 lower-case hex characters. */
export function hexId(): string {
  return randomBytes(8).toString("hex")
}

/** A grant id: a UUID, as Nylas v3 uses. */
export const grantId = () => randomUUID()

/** The limit a list call asked for, within Nylas's bounds. */
function limitOf(c: Context): number {
  const asked = Number(c.req.query("limit") ?? 50)

  return Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 200) : 50
}

/** A page of `items` from the `page_token` offset, with the cursor to the next page. */
export function page(c: Context, items: readonly unknown[]): Response {
  const limit = limitOf(c)
  const offset = Number(c.req.query("page_token") ?? 0) || 0
  const data = items.slice(offset, offset + limit)
  const more = offset + limit < items.length

  return c.json({
    request_id: requestId(),
    data,
    ...(more && { next_cursor: String(offset + limit) }),
  })
}

/** A JSON request body as a record; anything else is an empty one. */
export async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  try {
    return asRecord(await c.req.json()) ?? {}
  } catch {
    return {}
  }
}

/** A string field of a body, if it is one. */
export function text(body: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = body[key]

  return typeof value === "string" ? value : undefined
}

/** A list of `{ email, name }` from a body field. */
export function people(value: unknown): NylasEmailName[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const record = asRecord(item)
    const email = record?.["email"]

    if (typeof email !== "string") return []

    const name = record?.["name"]

    return [{ email, ...(typeof name === "string" && { name }) }]
  })
}

/** A string-to-string metadata map from a body field. */
export function metadataOf(value: unknown): Record<string, string> {
  const record = asRecord(value) ?? {}

  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item] as const] : [],
    ),
  )
}

/** The first characters of `html` as plain text, for a message's snippet. */
export function snippetOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
}
