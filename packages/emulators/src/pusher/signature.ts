import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { PusherApp } from "./entities.ts"

/**
 * Pusher's signatures. API requests carry `auth_key`, `auth_timestamp`, `auth_version` and, with a
 * body, `body_md5` in the query, plus `auth_signature`: the hex HMAC-SHA256 of
 * `METHOD\npath\nquery` (the other parameters, lower-cased and sorted) with the app's secret.
 * Private and presence channels are authorised as `key:` + the HMAC of `socket_id:channel` (and
 * `:channel_data` for presence), user sign-in as the HMAC of `socket_id::user::user_data`.
 */

const hmac = (secret: string, text: string) =>
  createHmac("sha256", secret).update(text).digest("hex")

/** Whether two hex digests are equal, in constant time. */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  return left.length === right.length && timingSafeEqual(left, right)
}

/** The string an API request's signature covers. */
function stringToSign(method: string, path: string, params: URLSearchParams): string {
  const query = [...params]
    .filter(([name]) => name !== "auth_signature")
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&")

  return `${method}\n${path}\n${query}`
}

/** How far a request's `auth_timestamp` may be from the server's clock. */
const TIMESTAMP_WINDOW_S = 600

/** The query parameters a signed request needs, with their values. */
function requireParam(params: URLSearchParams, name: string): string {
  const value = params.get(name)

  if (value === null) throw new HttpError(401, `Missing parameter: ${name}`)

  return value
}

/**
 * Checks a Channels API request's signature, timestamp and body hash against `app`'s secret, and
 * throws the 401 Pusher answers when any is wrong.
 */
export function verifyApiRequest(
  app: PusherApp,
  request: { method: string; path: string; params: URLSearchParams; body: string },
  now: Date,
): void {
  const { params } = request
  const timestamp = Number(requireParam(params, "auth_timestamp"))
  const nowS = Math.floor(now.getTime() / 1000)

  if (!Number.isFinite(timestamp) || Math.abs(nowS - timestamp) > TIMESTAMP_WINDOW_S)
    throw new HttpError(
      401,
      `Timestamp expired: Given timestamp (${params.get("auth_timestamp")}) not within ${TIMESTAMP_WINDOW_S}s of server time (${nowS})`,
    )

  if (request.body !== "") {
    const md5 = createHash("md5").update(request.body).digest("hex")

    if (params.get("body_md5") !== md5)
      throw new HttpError(401, `Invalid body_md5: you should have sent ${md5}`)
  }

  const expected = stringToSign(request.method, request.path, params)

  if (!sameDigest(requireParam(params, "auth_signature"), hmac(app.secret, expected)))
    throw new HttpError(
      401,
      `Invalid signature: you should have sent HmacSHA256Hex(${JSON.stringify(expected)}, your_secret)`,
    )
}

/** The query a server SDK would sign for an API request, for tests that call the API by hand. */
export function signedQuery(
  app: PusherApp,
  method: string,
  path: string,
  body: string,
  now: Date,
): URLSearchParams {
  const params = new URLSearchParams({
    auth_key: app.key,
    auth_timestamp: String(Math.floor(now.getTime() / 1000)),
    auth_version: "1.0",
  })

  if (body !== "") params.set("body_md5", createHash("md5").update(body).digest("hex"))
  params.set("auth_signature", hmac(app.secret, stringToSign(method, path, params)))

  return params
}

/** Whether `auth` (`key:signature`) authorises `socketId` on a private or presence channel. */
export function channelAuthValid(
  app: PusherApp,
  socketId: string,
  channel: string,
  auth: unknown,
  channelData?: string,
): boolean {
  if (typeof auth !== "string") return false

  const [key, signature] = auth.split(":")
  const signed =
    channelData === undefined ? `${socketId}:${channel}` : `${socketId}:${channel}:${channelData}`

  return (
    key === app.key && signature !== undefined && sameDigest(signature, hmac(app.secret, signed))
  )
}

/** Whether `auth` signs `socketId` in as the user described by `userData`. */
export function userAuthValid(
  app: PusherApp,
  socketId: string,
  userData: string,
  auth: unknown,
): boolean {
  if (typeof auth !== "string") return false

  const [key, signature] = auth.split(":")

  return (
    key === app.key &&
    signature !== undefined &&
    sameDigest(signature, hmac(app.secret, `${socketId}::user::${userData}`))
  )
}

/** The headers of a webhook: `X-Pusher-Key` and the hex HMAC-SHA256 of the body, with the secret. */
export function pusherWebhookHeaders(
  key: string,
  secret: string,
  body: string,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Pusher-Key": key,
    "X-Pusher-Signature": hmac(secret, body),
  }
}

/**
 * When a webhook that failed is tried again. Pusher retries for up to five minutes without
 * publishing its schedule; this spreads the retries over that window, an approximation.
 */
export const PUSHER_DELIVERY = {
  retryDelaysMs: [5_000, 15_000, 30_000, 60_000, 120_000],
  timeoutMs: 3_000,
} as const
