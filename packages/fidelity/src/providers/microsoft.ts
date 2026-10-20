/**
 * Microsoft's fidelity suite. Without an account it reads what needs no tenant: the identity
 * platform's discovery document and signing keys for the `common` authority (live with the public
 * opt-in). With a test account signed in through `danwo fidelity login microsoft`, it also runs
 * Graph mail, calendar, OneDrive and subscriptions as that account; the documented goldens come
 * from Graph's OpenAPI description.
 */
import { microsoft, seedMicrosoft } from "@danwo/emulators"

import {
  accountJson,
  accountOrPublicTarget,
  emulatedAccountTarget,
  SIGNED_IN,
} from "../account-target.ts"
import { MICROSOFT_ACCOUNT } from "../accounts.ts"
import { graphDescription } from "../discovery.ts"
import { type FidelityProvider, PUBLIC_ENDPOINTS } from "../provider.ts"
import type { Scenario, Target } from "../scenario.ts"
import { asJsonObject, readJson } from "../shape.ts"
import { isTagged, type Leftover, SweepUnavailable } from "../sweep.ts"
import { GRAPH, GRAPH_PATHS, GRAPH_SCENARIOS, purgeMessages, valuesOf } from "./graph.ts"

const LOGIN = "https://login.microsoftonline.com/common"

/** Graph's v1.0 OpenAPI description, as Microsoft publishes it. */
const GRAPH_DESCRIPTION =
  "https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/v1.0/openapi.yaml"

const discovery: Scenario = {
  name: "sign-in: discovery document",
  async run(context) {
    await context.step(
      "read the discovery document",
      new Request(`${LOGIN}/v2.0/.well-known/openid-configuration`),
      { literals: ["issuer", "jwks_uri", "token_endpoint", "authorization_endpoint"] },
    )
  },
}

const keys: Scenario = {
  name: "sign-in: signing keys",
  async run(context) {
    await context.step("read the signing keys", new Request(`${LOGIN}/discovery/v2.0/keys`), {
      literals: ["keys[].kty", "keys[].use"],
    })
  },
}

async function describeGraph() {
  const response = await fetch(GRAPH_DESCRIPTION)

  if (!response.ok)
    throw new Error(`could not download Graph's OpenAPI description: ${response.status}`)

  return graphDescription(await response.text(), GRAPH_PATHS)
}

/** Tagged items of a collection, each removed by the request `remove` makes for it. */
async function tagged(
  target: Target,
  kind: string,
  url: string,
  named: string,
  remove: (id: string, label: string) => Promise<Response>,
): Promise<Leftover[]> {
  return valuesOf(await readJson(await target.send(accountJson("GET", url)))).flatMap((item) => {
    const object = asJsonObject(item)
    const id = typeof object?.["id"] === "string" ? object["id"] : ""
    const label = typeof object?.[named] === "string" ? object[named] : ""

    return isTagged(label)
      ? [{ kind, id, label, tagged: true, remove: () => remove(id, label) }]
      : []
  })
}

/** The account's `collection` filtered to subjects that start with the tag. */
function taggedSubjects(collection: string): string {
  return `${GRAPH}/me/${collection}?$filter=${encodeURIComponent("startswith(subject,'danwo-fidelity')")}`
}

/** Everything tagged in the signed-in test account: mail, events and OneDrive files. */
async function sweepMicrosoft(target: Target): Promise<readonly Leftover[]> {
  if (target.credentials[SIGNED_IN] === undefined)
    throw new SweepUnavailable(
      "needs a signed-in test account: run `danwo fidelity login microsoft`",
    )

  return [
    ...(await tagged(target, "message", taggedSubjects("messages"), "subject", (_, subject) =>
      purgeMessages(target, subject),
    )),
    ...(await tagged(target, "event", taggedSubjects("events"), "subject", (id) =>
      target.send(accountJson("DELETE", `${GRAPH}/me/events/${id}`)),
    )),
    ...(await tagged(target, "file", `${GRAPH}/me/drive/root/children`, "name", (id) =>
      target.send(accountJson("DELETE", `${GRAPH}/me/drive/items/${id}`)),
    )),
  ]
}

const { clientId, clientSecret, refreshToken, account, tenant } = MICROSOFT_ACCOUNT.variables

export const microsoftFidelity: FidelityProvider = {
  name: "microsoft",
  leaves:
    "deleted OneDrive files sit in the recycle bin until it is emptied; mail, events are deleted",
  credentials: [
    { ...PUBLIC_ENDPOINTS, optional: true },
    {
      name: clientId,
      description: "the app registration a test account signs in with",
      optional: true,
    },
    { name: clientSecret, description: "that registration's client secret", optional: true },
    {
      name: tenant ?? "",
      description: "the tenant to sign in through; common by default",
      optional: true,
    },
    {
      name: refreshToken,
      description: "the test account's refresh token, written by `danwo fidelity login microsoft`",
      optional: true,
    },
    {
      name: account,
      description: "the account the suite may act as when it is not a personal Outlook address",
      optional: true,
    },
  ],
  scenarios: [discovery, keys, ...GRAPH_SCENARIOS],
  describe: describeGraph,
  sweep: sweepMicrosoft,
  emulator: () =>
    emulatedAccountTarget(MICROSOFT_ACCOUNT, {
      definition: microsoft,
      email: "danwo.fidelity@outlook.com",
      seed: (emulator, client) =>
        seedMicrosoft(emulator, {
          users: [{ email: "danwo.fidelity@outlook.com", name: "Danwo Fidelity" }],
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
  live: (env) => accountOrPublicTarget(MICROSOFT_ACCOUNT, env),
}
