import { createHash, randomUUID } from "node:crypto"

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
