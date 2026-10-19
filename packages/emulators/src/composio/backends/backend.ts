/**
 * What a backend emulator does for Composio: the provider a toolkit's tools act on (Gmail on the
 * Google emulator, Slack on Slack's). Composio connects accounts with the provider's real OAuth
 * flow and runs tools as calls to the provider's real API, so what an agent does through Composio
 * lands in that emulator's state, where tests can see it.
 */
import type { Emulator } from "../../define.ts"
import { asRecord } from "../../json.ts"
import { OAUTH_CALLBACK } from "../helpers.ts"

/** Sends a request to the backend emulator, addressed to the provider's real hostname. */
export type Send = (request: Request) => Promise<Response>

/** An OAuth app at the provider. */
export interface OAuthClient {
  readonly client_id: string
  readonly client_secret: string
}

/** What the provider's token endpoint gave for a consent or a refresh. */
export interface TokenSet {
  readonly access_token: string
  readonly refresh_token?: string
  readonly expires_in?: number
  readonly scope?: string
  readonly token_type?: string
}

/** What a tool's call to the provider came back with. */
export interface BackendAnswer {
  readonly status: number
  readonly data: unknown
  /** Set when the provider refused or failed the call. */
  readonly error?: string
}

/** One tool, as calls to the provider's API. */
export type Executor = (call: {
  readonly args: Readonly<Record<string, unknown>>
  readonly token: string
  readonly send: Send
}) => Promise<BackendAnswer>

export interface Backend {
  readonly name: BackendName
  readonly toolkits: readonly string[]
  /** Composio's own app at the provider, for auth configs that are Composio-managed. */
  readonly managedClient: OAuthClient
  /** Where the browser goes to consent to `scopes` for `client`, coming back with `state`. */
  authorizeUrl(client: OAuthClient, scopes: readonly string[], state: string): string
  /** Exchanges the code the provider sent back for tokens. */
  exchange(send: Send, client: OAuthClient, code: string): Promise<TokenSet>
  /** New tokens from a refresh token; undefined when the provider refuses it. */
  refresh(send: Send, client: OAuthClient, refreshToken: string): Promise<TokenSet | undefined>
  /** Who the token acts as (an email, a login), for the account's label. */
  whoami(send: Send, token: string): Promise<string | null>
  /** Registers Composio's managed app with the backend emulator unless it is there already. */
  register(emulator: Emulator, client: OAuthClient): void
  /** The API origin a toolkit's proxied calls are relative to. */
  apiBase(toolkit: string): string
  readonly tools: Readonly<Record<string, Executor>>
}

export type BackendName = "google" | "slack" | "github" | "microsoft"

/** A JSON or text body, read whatever the provider sent. */
async function bodyOf(response: Response): Promise<unknown> {
  const raw = await response.text()

  if (raw === "") return {}

  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Calls the provider's API with the account's bearer token, JSON in and out. */
export async function apiCall(
  send: Send,
  token: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<BackendAnswer> {
  const response = await send(
    new Request(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  )
  const data = await bodyOf(response)

  return response.ok ? { status: response.status, data } : failed(response.status, data)
}

/** A refused or failed call, with the provider's message as the error. */
export function failed(status: number, data: unknown): BackendAnswer {
  const record = asRecord(data)
  const nested = asRecord(record?.["error"])
  const message =
    nested?.["message"] ?? record?.["message"] ?? record?.["error_description"] ?? record?.["error"]

  return {
    status,
    data,
    error: `${status}: ${typeof message === "string" ? message : JSON.stringify(data)}`,
  }
}

/** Posts a form to a provider's token endpoint and reads the JSON it answers. */
export async function tokenCall(
  send: Send,
  url: string,
  fields: Readonly<Record<string, string>>,
): Promise<{ readonly ok: boolean; readonly body: Record<string, unknown> }> {
  const response = await send(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(fields),
    }),
  )
  const body = asRecord(await bodyOf(response)) ?? {}

  return { ok: response.ok && body["ok"] !== false && body["error"] === undefined, body }
}

/** The tokens in a token endpoint's answer, or an error naming what the provider said. */
export function tokensOf(answer: {
  readonly ok: boolean
  readonly body: Record<string, unknown>
}): TokenSet {
  const { body } = answer
  const token = body["access_token"]

  if (!answer.ok || typeof token !== "string")
    throw new Error(`token exchange failed: ${JSON.stringify(body["error"] ?? body)}`)

  return {
    access_token: token,
    ...(typeof body["refresh_token"] === "string" && { refresh_token: body["refresh_token"] }),
    ...(typeof body["expires_in"] === "number" && { expires_in: body["expires_in"] }),
    ...(typeof body["scope"] === "string" && { scope: body["scope"] }),
    ...(typeof body["token_type"] === "string" && { token_type: body["token_type"] }),
  }
}

/** Code exchange and refresh at a provider's token endpoint, the standard way. */
export function tokenEndpoint(url: string): Pick<Backend, "exchange" | "refresh"> {
  return {
    exchange: async (send, client, code) =>
      tokensOf(
        await tokenCall(send, url, {
          grant_type: "authorization_code",
          code,
          redirect_uri: OAUTH_CALLBACK,
          ...client,
        }),
      ),
    async refresh(send, client, refreshToken) {
      const answer = await tokenCall(send, url, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        ...client,
      })

      return answer.ok ? tokensOf(answer) : undefined
    },
  }
}

/** A string argument, or undefined. */
export function arg(args: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = args[name]

  return typeof value === "string" && value !== "" ? value : undefined
}

/** A list-of-strings argument, accepting one string too. */
export function argList(args: Readonly<Record<string, unknown>>, name: string): string[] {
  const value = args[name]

  if (typeof value === "string") return value === "" ? [] : [value]

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

/** A number argument, or undefined. */
export function argNumber(
  args: Readonly<Record<string, unknown>>,
  name: string,
): number | undefined {
  const value = args[name]

  return typeof value === "number" ? value : undefined
}

/** A URL with the defined `params` set in its query. */
export function withQuery(
  url: string,
  params: Readonly<Record<string, string | number | undefined>>,
): string {
  const target = new URL(url)

  for (const [key, value] of Object.entries(params))
    if (value !== undefined) target.searchParams.set(key, String(value))

  return target.toString()
}
