import { createHash, createHmac } from "node:crypto"

import type { App, Context } from "../http.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { NangoStore } from "./store.ts"

/** The hosts the Nango emulator answers: the API and the hosted Connect UI. */
export const NANGO_HOSTS: readonly string[] = ["api.nango.dev", "connect.nango.dev"]

export const CONNECT_ORIGIN = "https://connect.nango.dev"

/** What every group of Nango routes is registered with. */
export interface NangoRouteContext {
  readonly app: App
  readonly objects: NangoStore
  readonly outbox: Outbox
  readonly clock: Clock
  readonly store: Store
}

/** A failure answered in Nango's error envelope. */
export class NangoError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "NangoError"
    this.status = status
    this.code = code
  }
}

/** Nango's error envelope: `{ error: { code, message } }`. */
export function nangoError(c: Context, status: number, code: string, message: string): Response {
  return c.json({ error: { message, code, payload: {} } }, status)
}

/** Whether the request carries one of the environment's secret keys. */
export function requireSecret(context: NangoRouteContext, c: Context): void {
  const header = c.req.header("authorization") ?? ""
  const key = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
  const keys = context.objects.secretKeys.all()

  if (key === "")
    throw new NangoError(
      401,
      "missing_auth_header",
      "Authentication failed. The request is missing the Authorization header.",
    )
  if (keys.length > 0 && !keys.includes(key))
    throw new NangoError(
      401,
      "unknown_account",
      "Authentication failed. The provided authorization header does not match any account.",
    )
}

/** An ISO time `ms` from now on the emulator's clock. */
export const isoIn = (clock: Clock, ms: number) => new Date(clock().getTime() + ms).toISOString()

/**
 * The headers Nango signs a webhook with: the legacy `X-Nango-Signature` (SHA-256 of the key and
 * the JSON body together) and `X-Nango-Hmac-Sha256` (HMAC-SHA256 of the raw body), both hex.
 */
export function nangoWebhookHeaders(secret: string, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Nango-Signature": createHash("sha256").update(`${secret}${body}`).digest("hex"),
    "X-Nango-Hmac-Sha256": createHmac("sha256", secret).update(body).digest("hex"),
  }
}

/** Nango retries a webhook a few times; the schedule is an approximation. */
export const NANGO_DELIVERY = {
  retryDelaysMs: [10_000, 60_000, 5 * 60_000],
  timeoutMs: 20_000,
} as const
