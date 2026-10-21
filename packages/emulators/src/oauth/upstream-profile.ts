import { asRecord } from "../json.ts"

/** How an emulator reaches a social provider's token and profile endpoints. */
export type ProfileUpstream = (request: Request) => Promise<Response>

/** A social provider's code exchange and profile endpoints. */
export interface ProfileEndpoints {
  readonly token: string
  readonly profile: string
}

/**
 * Who signed in at a social provider, as an identity service (an Auth0 tenant, a Clerk instance)
 * finds out: it exchanges the authorization code at the token endpoint with `grant` (the code,
 * redirect URI, client credentials and any PKCE verifier), then reads the profile with the access
 * token. Undefined when either answer is refused.
 */
export async function upstreamProfile(
  upstream: ProfileUpstream,
  endpoints: ProfileEndpoints,
  grant: Readonly<Record<string, string>>,
): Promise<Record<string, unknown> | undefined> {
  const exchange = await upstream(
    new Request(endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", ...grant }),
    }),
  )
  const token = asRecord(await exchange.json())?.["access_token"]

  if (!exchange.ok || typeof token !== "string" || token === "") return undefined

  const me = await upstream(
    new Request(endpoints.profile, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    }),
  )
  const profile = asRecord(await me.json())

  return me.ok ? profile : undefined
}
