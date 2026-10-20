/**
 * Google's fidelity suite. Without an account it reads what needs none: the OpenID Connect
 * discovery document and the signing keys (live with the public opt-in). With a test account
 * signed in through `danwo fidelity login google`, it also runs Gmail, Calendar and Drive as that
 * account; the documented goldens come from Google's Discovery documents.
 */
import { google, seedGoogle } from "@danwo/emulators"

import { accountOrPublicTarget, emulatedAccountTarget } from "../account-target.ts"
import { GOOGLE_ACCOUNT } from "../accounts.ts"
import { discoveryDescription } from "../discovery.ts"
import { type FidelityProvider, PUBLIC_ENDPOINTS } from "../provider.ts"
import type { Scenario } from "../scenario.ts"
import { sweepGoogle } from "./google-sweep.ts"
import { GOOGLE_ACCOUNT_SCENARIOS } from "./google-workspace.ts"

const discovery: Scenario = {
  name: "sign-in: discovery document",
  async run(context) {
    await context.step(
      "read the discovery document",
      new Request("https://accounts.google.com/.well-known/openid-configuration"),
      { literals: ["issuer", "jwks_uri", "token_endpoint", "authorization_endpoint"] },
    )
  },
}

const keys: Scenario = {
  name: "sign-in: signing keys",
  async run(context) {
    await context.step(
      "read the signing keys",
      new Request("https://www.googleapis.com/oauth2/v3/certs"),
      { literals: ["keys[].kty", "keys[].alg", "keys[].use"] },
    )
  },
}

/** Google's Discovery documents for the APIs the suite calls. */
const DISCOVERY = {
  gmail: "https://gmail.googleapis.com/$discovery/rest?version=v1",
  calendar: "https://calendar-json.googleapis.com/$discovery/rest?version=v3",
  drive: "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
}

async function describeGoogle() {
  const documents = await Promise.all(
    Object.entries(DISCOVERY).map(async ([api, url]) => {
      const response = await fetch(url)

      if (!response.ok)
        throw new Error(`could not download Google's ${api} Discovery document: ${response.status}`)

      return [api, await response.json()] as const
    }),
  )

  return discoveryDescription(Object.fromEntries(documents))
}

const { clientId, clientSecret, refreshToken, account } = GOOGLE_ACCOUNT.variables

export const googleFidelity: FidelityProvider = {
  name: "google",
  leaves:
    "messages it sent go to the trash, which Gmail empties after 30 days; labels, events and files are deleted",
  credentials: [
    { ...PUBLIC_ENDPOINTS, optional: true },
    {
      name: clientId,
      description: "the OAuth client a test account signs in with",
      optional: true,
    },
    { name: clientSecret, description: "that client's secret", optional: true },
    {
      name: refreshToken,
      description: "the test account's refresh token, written by `danwo fidelity login google`",
      optional: true,
    },
    {
      name: account,
      description: "the account the suite may act as when it is not a personal Gmail address",
      optional: true,
    },
  ],
  scenarios: [discovery, keys, ...GOOGLE_ACCOUNT_SCENARIOS],
  describe: describeGoogle,
  openapiLooseNulls: true,
  sweep: sweepGoogle,
  emulator: () =>
    emulatedAccountTarget(GOOGLE_ACCOUNT, {
      definition: google,
      email: "danwo.fidelity@gmail.com",
      seed: (emulator, client) =>
        seedGoogle(emulator.store, {
          users: [{ email: "danwo.fidelity@gmail.com", name: "Danwo Fidelity" }],
          oauth_clients: [
            {
              client_id: client.id,
              client_secret: client.secret,
              name: "danwo fidelity",
              redirect_uris: [client.redirect],
            },
          ],
        }),
    }),
  live: (env) => accountOrPublicTarget(GOOGLE_ACCOUNT, env),
}
