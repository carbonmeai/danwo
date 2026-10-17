import { createHash, randomBytes, randomUUID } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import type { Clock } from "../store.ts"
import type { MicrosoftUser } from "./entities.ts"

/** The tenant every personal Microsoft account belongs to. */
export const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad"

export const MICROSOFT_LOGIN = "https://login.microsoftonline.com"

/** The hosts Microsoft sign-in and Graph use; route them to the emulator. */
export const MICROSOFT_HOSTS = ["login.microsoftonline.com", "graph.microsoft.com"] as const

/** Whether the tenant path a request came in on lets `user` sign in. */
export function tenantAllows(tenant: string, user: MicrosoftUser): boolean {
  const personal = user.tenant_id === CONSUMER_TENANT_ID

  if (tenant === "common") return true
  if (tenant === "consumers") return personal
  if (tenant === "organizations") return !personal

  return user.tenant_id === tenant
}

/** The issuer a tenant path advertises: a template for the multi-tenant paths. */
export function issuerFor(tenant: string): string {
  const id = tenant === "consumers" ? CONSUMER_TENANT_ID : tenant
  const multi = tenant === "common" || tenant === "organizations"

  return `${MICROSOFT_LOGIN}/${multi ? "{tenantid}" : id}/v2.0`
}

/** Microsoft's per-app subject: the same user has a different `sub` in each app. */
export function pairwiseSubject(oid: string, clientId: string): string {
  return createHash("sha256").update(`${oid}:${clientId}`).digest("base64url").slice(0, 43)
}

/** One Graph failure: its status, error code and message, plus any response headers. */
export interface GraphFailure {
  readonly status: number
  readonly code: string
  readonly message: string
  readonly headers?: Record<string, string>
}

/** Graph's error body, with the request ids every Graph error carries. */
function graphErrorBody(clock: Clock, failure: Pick<GraphFailure, "code" | "message">) {
  return {
    error: {
      code: failure.code,
      message: failure.message,
      innerError: {
        date: clock().toISOString(),
        "request-id": randomUUID(),
        "client-request-id": randomUUID(),
      },
    },
  }
}

/** A failure a Graph handler throws, answered with Graph's error body and this code. */
export class GraphProblem extends HttpError {
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(status, message)
    this.code = code
  }
}

/** Answers with Graph's error body. */
export function graphError(c: Context, clock: Clock, failure: GraphFailure): Response {
  return c.json(graphErrorBody(clock, failure), failure.status, failure.headers ?? {})
}

/** A Graph-style opaque id: `prefix` and random URL-safe characters. */
export function graphId(prefix: string, bytes = 24): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`
}

/** A fresh change key, which an item gets on every change and shows as its ETag. */
export function newChangeKey(): string {
  return randomBytes(12).toString("base64")
}

/** One AADSTS failure: its OAuth error, number and message. */
export interface AadFailure {
  readonly status: number
  readonly error: string
  readonly code: number
  readonly message: string
}

/** Entra ID's token error body, with the AADSTS code in the description and the code list. */
export function aadError(c: Context, clock: Clock, failure: AadFailure): Response {
  const timestamp = clock()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "Z")
  const trace = randomUUID()
  const correlation = randomUUID()

  return c.json(
    {
      error: failure.error,
      error_description: `AADSTS${failure.code}: ${failure.message} Trace ID: ${trace} Correlation ID: ${correlation} Timestamp: ${timestamp}`,
      error_codes: [failure.code],
      timestamp,
      trace_id: trace,
      correlation_id: correlation,
      error_uri: `${MICROSOFT_LOGIN}/error?code=${failure.code}`,
    },
    failure.status,
  )
}
