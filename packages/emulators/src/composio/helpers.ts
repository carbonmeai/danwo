import { randomBytes, randomUUID } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { App, Context, Handler } from "../http.ts"
import { asRecord } from "../json.ts"

/** The hosts the Composio emulator answers: the API and the hosted connect page. */
export const COMPOSIO_HOSTS = ["backend.composio.dev", "connect.composio.dev"]

const API_ORIGIN = "https://backend.composio.dev"

export const CONNECT_ORIGIN = "https://connect.composio.dev"

/** Where toolkits' OAuth providers send the user back to Composio after consent. */
export const OAUTH_CALLBACK = `${API_ORIGIN}/api/v3/toolkits/auth/callback`

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

/** A Composio id: the kind's prefix (`ac`, `ca`, `ti`…), an underscore and twelve random letters and digits. */
export function composioId(prefix: string, length = 12): string {
  return `${prefix}_${[...randomBytes(length)].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`
}

export const newUuid = (): string => randomUUID()

/** Where Composio's legacy flow registers a connection's app, as accounts started by a link record it. */
export const AUTH_APPS_ADD = `${API_ORIGIN}/api/v1/auth-apps/add`

const WORD_FIRST = [
  "amber",
  "brisk",
  "calm",
  "dusty",
  "eager",
  "fancy",
  "gentle",
  "hollow",
  "lucky",
]
const WORD_SECOND = [
  "acorn",
  "badger",
  "cedar",
  "delta",
  "ember",
  "falcon",
  "harbor",
  "maple",
  "otter",
]

function pick(words: readonly string[]): string {
  return words[(randomBytes(1)[0] ?? 0) % words.length] ?? words[0] ?? ""
}

/** A connected account's readable id, `<toolkit>_<word>-<word>` as Composio names them. */
export function wordId(toolkit: string): string {
  return `${toolkit}_${pick(WORD_FIRST)}-${pick(WORD_SECOND)}`
}

/** A random secret of `bytes` bytes, hex. */
export function secret(bytes = 24): string {
  return randomBytes(bytes).toString("hex")
}

/**
 * Composio's error envelope: `{ error: { message, code, slug, status, request_id, suggested_fix } }`,
 * the fields the SDK reads off a failed call.
 */
export function composioError(
  c: Context,
  status: number,
  code: number,
  slug: string,
  message: string,
  suggestedFix = "",
): Response {
  return c.json(
    {
      error: { message, code, slug, status, request_id: randomUUID(), suggested_fix: suggestedFix },
    },
    status,
  )
}

/** An error a handler throws to answer with Composio's envelope. */
export class ComposioError extends HttpError {
  readonly code: number
  readonly slug: string

  constructor(status: number, code: number, slug: string, message: string) {
    super(status, message)
    this.name = "ComposioError"
    this.code = code
    this.slug = slug
  }
}

/** A 404 for a missing `kind` with id `id`. */
export function notFound(kind: string, id: string, code: number, slug: string): ComposioError {
  return new ComposioError(404, code, slug, `${kind} ${id} not found`)
}

/** A 400 for a request that cannot be carried out as sent. */
export function badRequest(message: string): ComposioError {
  return new ComposioError(400, 302, "Request_ValidationError", message)
}

/** The JSON object a request sent, or an empty one for anything else. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const parsed: unknown = await c.req.json().catch(() => undefined)

  return asRecord(parsed) ?? {}
}

export function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/** A string list sent as a JSON array. */
export function textsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

/** A query parameter that takes a list: comma-joined, as the SDK sends arrays. */
export function queryList(c: Context, name: string): string[] {
  return (c.req.query(name) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

/** Whether a boolean query parameter is `true`. */
export function queryFlag(c: Context, name: string): boolean {
  return c.req.query(name) === "true"
}

/** Whether a list filter keeps `value`: an empty filter keeps everything. */
export function keeps(values: readonly string[], value: string): boolean {
  return values.length === 0 || values.includes(value)
}

const DEFAULT_LIMIT = 20

/** One page of `items` by the request's `limit` and `cursor`, in Composio's paged shape. */
export function page<T>(c: Context, items: readonly T[]) {
  const limit = Math.max(1, Number(c.req.query("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)
  const cursor = c.req.query("cursor")
  const start = cursor ? Number(Buffer.from(cursor, "base64url").toString()) || 0 : 0
  const end = start + limit

  return {
    items: items.slice(start, end),
    next_cursor: end < items.length ? Buffer.from(String(end)).toString("base64url") : null,
    total_pages: Math.max(1, Math.ceil(items.length / limit)),
    current_page: Math.floor(start / limit) + 1,
    total_items: items.length,
  }
}

type Add = (path: string, handler: Handler) => void

/** `add` for both API versions. */
function both(add: Add): Add {
  return (path, handler) => {
    add(`/api/v3${path}`, handler)
    add(`/api/v3.1${path}`, handler)
  }
}

/** Registers a route under both API versions the SDKs call, `/api/v3` and `/api/v3.1`. */
export function api(app: App) {
  return {
    get: both((path, handler) => app.get(path, handler)),
    post: both((path, handler) => app.post(path, handler)),
    put: both((path, handler) => app.put(path, handler)),
    patch: both((path, handler) => app.patch(path, handler)),
    delete: both((path, handler) => app.delete(path, handler)),
  }
}

/** A time as Composio writes it: ISO 8601 in UTC. */
export function iso(date: Date): string {
  return date.toISOString()
}

/** A slug as the catalogue keys it: lower case. */
export function toolkitKey(slug: string): string {
  return slug.toLowerCase()
}
