import { google as googleapis } from "googleapis"
import { expect } from "vitest"

import { createEmulator, type Emulator, type EmulatorOptions } from "../src/define.ts"
import { google, type GoogleSeedConfig, seedGoogle } from "../src/google/index.ts"

/** Test helpers for the Google API emulators: an app's OAuth client and the official clients. */

const CLIENT_ID = "123-integration.apps.googleusercontent.com"
const CLIENT_SECRET = "GOCSPX-integration-secret"
const REDIRECT_URI = "https://app.danwo.test/oauth/google/callback"

export const AUTH = "https://www.googleapis.com/auth/"

/** A Google emulator with Ada, Bob and the app's client, plus `extra` seed data. */
export function googleWith(extra: GoogleSeedConfig = {}, options: EmulatorOptions = {}): Emulator {
  const emulator = createEmulator(google, options)

  seedGoogle(emulator.store, {
    users: [
      { email: "ada@danwo.test", name: "Ada Lovelace" },
      { email: "bob@danwo.test", name: "Bob Builder" },
    ],
    oauth_clients: [
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        name: "Integration",
        redirect_uris: [REDIRECT_URI],
      },
    ],
    ...extra,
  })

  return emulator
}

/** A fetch that sends every request to the emulator, keeping Google's real URLs. */
export function fetchVia(emulator: Emulator): typeof fetch {
  return async (input, init) =>
    emulator.fetch(new Request(input, { ...init, ...(init?.body && { duplex: "half" }) }))
}

/** What the token endpoint answered for a consent. */
export interface Tokens {
  readonly access_token: string
  readonly refresh_token?: string
  readonly scope: string
}

/**
 * Plays the user consenting to `scopes` for the app (the account chooser and the redirect), then
 * the app exchanging the code at the token endpoint.
 */
export async function consent(
  emulator: Emulator,
  email: string,
  scopes: readonly string[],
  extra: Record<string, string> = {},
): Promise<Tokens> {
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth")

  for (const [key, value] of Object.entries({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    ...extra,
  }))
    authorize.searchParams.set(key, value)

  const page = await (await emulator.fetch(new Request(authorize))).text()
  const request = /name="request" value="([^"]+)"/.exec(page)?.[1] ?? ""
  const item = page.split("<li>").find((li) => li.includes(email)) ?? ""
  const user = /name="user" value="([^"]+)"/.exec(item)?.[1] ?? ""
  const back = await emulator.fetch(
    new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request, user }),
    }),
  )
  const code = new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? ""
  const token = await emulator.fetch(
    new Request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }),
  )

  expect(token.status).toBe(200)

  return (await token.json()) as Tokens
}

/** An OAuth2 client holding `tokens`, whose own calls (refresh) also reach the emulator. */
export function authFor(emulator: Emulator, tokens: Tokens) {
  const auth = new googleapis.auth.OAuth2({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    transporterOptions: { fetchImplementation: fetchVia(emulator) },
  })

  auth.setCredentials(tokens)

  return auth
}

/** The status and Google error reason of a failed client call. */
export async function failure(call: Promise<unknown>): Promise<{ status: number; reason: string }> {
  try {
    await call
  } catch (error) {
    const { status, response } = error as {
      status?: number
      response?: { data?: { error?: { errors?: { reason?: string }[] } } }
    }

    return { status: status ?? 0, reason: response?.data?.error?.errors?.[0]?.reason ?? "" }
  }

  throw new Error("expected the call to fail")
}

/** `value`, which the test expects to be there. */
export function only<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value")

  return value
}
