import { randomInt } from "node:crypto"

import type { Context } from "../http.ts"

/** The issuer in Google's ID tokens and discovery document. */
export const GOOGLE_ISSUER = "https://accounts.google.com"

/** The hosts Google sign-in uses; route them to the emulator. */
export const GOOGLE_HOSTS = [
  "accounts.google.com",
  "oauth2.googleapis.com",
  "openidconnect.googleapis.com",
  "www.googleapis.com",
] as const

/** Google's real endpoint URLs; the emulator serves them all, through the proxy. */
export const GOOGLE_ENDPOINTS = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
  revocation: "https://oauth2.googleapis.com/revoke",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
} as const

/** Where the account chooser posts the choice. */
export const CHOOSER_ACTION = "/o/oauth2/v2/auth/callback"

/** A 21-digit numeric id, the shape of Google's `sub`. */
export function newUid(): string {
  return `1${Array.from({ length: 20 }, () => randomInt(10)).join("")}`
}

/** Google's OAuth error body: `{ error, error_description }`. */
export function googleError(
  c: Context,
  status: number,
  error: string,
  description: string,
): Response {
  return c.json({ error, error_description: description }, status)
}

const SCOPE_URLS: Readonly<Record<string, string>> = {
  email: "https://www.googleapis.com/auth/userinfo.email",
  profile: "https://www.googleapis.com/auth/userinfo.profile",
}

/** The scope Google reports as granted: `email` and `profile` as their full URLs. */
export function grantedScope(requested: string): string {
  return requested
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => SCOPE_URLS[scope] ?? scope)
    .join(" ")
}

/** Whether `scope` includes any of `names`, short or as a URL. */
export function includesScope(scope: string, ...names: string[]): boolean {
  const granted = scope.split(/\s+/)

  return names.some((name) => granted.includes(name) || granted.includes(SCOPE_URLS[name] ?? name))
}
