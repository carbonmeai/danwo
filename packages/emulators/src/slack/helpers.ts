import { createHash, randomBytes } from "node:crypto"

import { randomChars } from "../random.ts"
import type { Clock, DataKey, Store } from "../store.ts"

/** The hosts the Slack emulator answers: the Web API and OAuth, webhooks and file uploads. */
export const SLACK_HOSTS = ["slack.com", "api.slack.com", "hooks.slack.com", "files.slack.com"]

export const HOOKS_BASE = "https://hooks.slack.com"
export const FILES_BASE = "https://files.slack.com"

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** An id in Slack's style: a type letter (`T` team, `U` user, `C` channel…) and 10 characters. */
export function slackId(prefix: string, length = 10): string {
  return prefix + randomChars(ALPHABET, length)
}

/**
 * A Slack-style id derived from `seed`, the same on every call. Used where an id must survive a
 * reseed, such as an app's id, which names its event endpoint.
 */
export function stableSlackId(prefix: string, seed: string, length = 10): string {
  const bytes = createHash("sha256").update(`${prefix}:${seed}`).digest().subarray(0, length)

  return prefix + [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")
}

/** A random secret of `bytes` bytes, hex. */
export function secretHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex")
}

/** Unix seconds now. */
export function unixNow(clock: Clock): number {
  return Math.floor(clock().getTime() / 1000)
}

/** The last message timestamp handed out, in micro-seconds. */
const LAST_TS: DataKey<number> = { name: "slack.last_ts" }

/**
 * The next message timestamp: Unix seconds with six digits of micro-seconds, always later than the
 * previous one, which is how Slack keeps `ts` unique within a channel.
 */
export function nextTs(store: Store): string {
  const micros = store.clock().getTime() * 1000
  const last = store.getData(LAST_TS) ?? 0
  const value = Math.max(micros, last + 1)

  store.setData(LAST_TS, value)

  return `${Math.floor(value / 1e6)}.${String(value % 1e6).padStart(6, "0")}`
}

/**
 * An error a Web API method answers with. Slack answers API errors with HTTP 200 and
 * `{ ok: false, error }`, plus any fields in `extra` (`needed` and `provided` for `missing_scope`).
 */
export class SlackApiError extends Error {
  readonly error: string
  readonly extra: Readonly<Record<string, unknown>>

  constructor(error: string, extra: Readonly<Record<string, unknown>> = {}) {
    super(error)
    this.name = "SlackApiError"
    this.error = error
    this.extra = extra
  }
}

/** The arguments of one Web API call, from its form, JSON body or query string. */
export type Args = Readonly<Record<string, unknown>>

/** A string argument; numbers and booleans are read as their text, as Slack's forms send them. */
export function stringArg(args: Args, name: string): string | undefined {
  const value = args[name]

  if (typeof value === "string") return value === "" ? undefined : value
  if (typeof value === "number" || typeof value === "boolean") return String(value)

  return undefined
}

/** A required string argument, or the error Slack answers when it is missing. */
export function requireArg(args: Args, name: string, error: string): string {
  const value = stringArg(args, name)

  if (value === undefined) throw new SlackApiError(error)

  return value
}

/** A boolean argument sent as `true`, `1` or a JSON boolean. */
export function flagArg(args: Args, name: string): boolean {
  const value = stringArg(args, name)

  return value === "true" || value === "1"
}

/** A list argument: a JSON array, or a comma-separated string. */
export function listArg(args: Args, name: string): string[] {
  const value = args[name]

  if (Array.isArray(value)) return value.filter((item) => typeof item === "string")

  return (stringArg(args, name) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

/** An argument holding JSON (blocks, a view, a files list), parsed if it came as a string. */
export function jsonArg(args: Args, name: string): unknown {
  const value = args[name]

  if (typeof value !== "string") return value

  try {
    const parsed: unknown = JSON.parse(value)

    return parsed
  } catch {
    throw new SlackApiError("invalid_arguments")
  }
}

/** A plain object, or undefined. */
export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined

  return Object.fromEntries(Object.entries(value))
}

/** An array argument (blocks, attachments), or null when absent. */
export function arrayArg(args: Args, name: string): unknown[] | null {
  const value = jsonArg(args, name)

  return Array.isArray(value) ? value : null
}

/** One page of `items` and the cursor to the next, as Slack's cursor pagination returns them. */
export interface Page<T> {
  readonly items: T[]
  readonly nextCursor: string
}

const encodeCursor = (offset: number) => Buffer.from(`next:${offset}`).toString("base64")

function decodeCursor(cursor: string): number {
  const match = /^next:(\d+)$/.exec(Buffer.from(cursor, "base64").toString())

  if (!match) throw new SlackApiError("invalid_cursor")

  return Number(match[1])
}

/** The page of `items` that `cursor` and `limit` ask for. */
export function paginate<T>(items: readonly T[], args: Args, defaultLimit = 100): Page<T> {
  const cursor = stringArg(args, "cursor")
  const start = cursor === undefined ? 0 : decodeCursor(cursor)
  const asked = Number(stringArg(args, "limit") ?? defaultLimit)
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 1000) : defaultLimit
  const end = start + limit

  return { items: items.slice(start, end), nextCursor: end < items.length ? encodeCursor(end) : "" }
}
