import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

import type { Context } from "../http.ts"
import { asRecord } from "../json.ts"
import type { Auth0TenantRecord } from "./entities.ts"
import type { Auth0Store } from "./store.ts"

/**
 * The domains Auth0 tenants live on, as the proxy routes them: the original one and each region.
 * Custom domains are added per tenant from the seed.
 */
export const AUTH0_HOSTS = [
  "*.auth0.com",
  "*.us.auth0.com",
  "*.eu.auth0.com",
  "*.au.auth0.com",
  "*.jp.auth0.com",
]

/** Whether `host` is an Auth0 tenant domain (custom domains aside). */
export function isAuth0Host(host: string): boolean {
  return /^[a-z0-9][a-z0-9-]*(\.(us|eu|au|jp))?\.auth0\.com$/i.test(host)
}

/** A tenant's issuer, with the trailing slash Auth0 puts on it. */
export function issuerOf(domain: string): string {
  return `https://${domain}/`
}

/** The audience a Management API token is issued for. */
export function managementAudience(domain: string): string {
  return `https://${domain}/api/v2/`
}

/** The host a request was sent to, without a port. */
export function requestHost(c: Context): string {
  return new URL(c.req.url).hostname.toLowerCase()
}

/** The tenant a request's host belongs to: its canonical domain or one of its custom domains. */
function tenantFor(auth0: Auth0Store, host: string): Auth0TenantRecord | undefined {
  return (
    auth0.tenants.findOneBy("domain", host) ??
    auth0.tenants.all().find((tenant) => tenant.aliases.includes(host))
  )
}

/** Thrown when a request's host is not a seeded tenant. */
export class UnknownTenant extends Error {
  readonly host: string

  constructor(host: string) {
    super(`no Auth0 tenant is set up for ${host}`)
    this.host = host
  }
}

/** The tenant a request is for; throws `UnknownTenant` for a host no tenant answers. */
export function requireTenant(c: Context, auth0: Auth0Store): Auth0TenantRecord {
  const tenant = tenantFor(auth0, requestHost(c))

  if (!tenant) throw new UnknownTenant(requestHost(c))

  return tenant
}

/** An OAuth error as Auth0's authentication API answers it. */
export function oauthError(c: Context, status: number, error: string, description: string) {
  return c.json({ error, error_description: description }, status)
}

/** A Management API error, as Auth0's API v2 answers it. */
export class ManagementError extends Error {
  readonly status: number
  readonly errorCode: string | undefined

  constructor(status: number, message: string, errorCode?: string) {
    super(message)
    this.status = status
    this.errorCode = errorCode
  }
}

const REASONS: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
}

/** The Management API's error body. */
export function managementErrorBody(status: number, message: string, errorCode?: string) {
  return {
    statusCode: status,
    error: REASONS[status] ?? "Error",
    message,
    ...(errorCode !== undefined && { errorCode }),
  }
}

/** A random lower-case hex id. */
export function hexId(bytes = 12): string {
  return randomBytes(bytes).toString("hex")
}

/** A random URL-safe token. */
export function opaque(bytes = 24): string {
  return randomBytes(bytes).toString("base64url")
}

/** A password hash for storage: random salt, scrypt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")

  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`
}

/** Whether `password` matches a stored hash. */
export function checkPassword(password: string, stored: string | null): boolean {
  const [salt = "", hash = ""] = (stored ?? "").split(":")

  if (salt === "" || hash === "") return false

  const given = scryptSync(password, salt, 32)
  const expected = Buffer.from(hash, "hex")

  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** The scopes in a space-separated list. */
export function scopesOf(scope: string | null | undefined): string[] {
  return (scope ?? "").split(/\s+/).filter(Boolean)
}

/** Whether a URL is one of `allowed`, where an entry may end in `*` to allow anything after it. */
export function urlAllowed(url: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) =>
    entry.endsWith("*") ? url.startsWith(entry.slice(0, -1)) : url === entry,
  )
}

/** A request's fields: Auth0's authentication API takes both a form and a JSON body. */
export async function requestFields(c: Context): Promise<Record<string, string>> {
  const type = c.req.header("content-type") ?? ""
  const text = await c.req.text()

  if (!type.includes("json")) return Object.fromEntries(new URLSearchParams(text))

  const body = asRecord(text === "" ? {} : JSON.parse(text)) ?? {}

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  )
}

/** A JSON request body as a record; an empty body is an empty record. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text()

  return asRecord(raw === "" ? {} : JSON.parse(raw)) ?? {}
}
