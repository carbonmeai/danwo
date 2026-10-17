import {
  AuthenticationHandler,
  Client,
  type Context,
  type Middleware,
  RedirectHandler,
  RetryHandler,
  RetryHandlerOptions,
} from "@microsoft/microsoft-graph-client"

import { createEmulator, type Emulator, type EmulatorOptions } from "../src/define.ts"
import { microsoft, type MicrosoftSeedConfig, seedMicrosoft } from "../src/microsoft/index.ts"
import { microsoftStore } from "../src/microsoft/store.ts"
import { issueAccessToken, issueRefreshToken } from "../src/oauth/tokens.ts"

export const CLIENT_ID = "6731de76-14a6-49ae-97bc-6eba6914391e"
export const CLIENT_SECRET = "Qx~8Q~app-secret"
export const WORK_TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47"
export const ADA = "ada@contoso.test"
export const GRACE = "grace@contoso.test"

/** The last step of the Graph client's chain: sends each request to the emulator. */
class EmulatorHandler implements Middleware {
  private readonly emulator: Emulator

  constructor(emulator: Emulator) {
    this.emulator = emulator
  }

  async execute(context: Context): Promise<void> {
    const request =
      typeof context.request === "string"
        ? new Request(context.request, context.options)
        : context.request

    context.response = await this.emulator.fetch(request)
  }
}

/** A Microsoft emulator with two work accounts, an app registration and `seed`'s content. */
export function graphEmulator(
  seed: MicrosoftSeedConfig = {},
  options: EmulatorOptions = {},
): Emulator {
  const emulator = createEmulator(microsoft, options)

  seedMicrosoft(emulator, {
    users: [
      { email: ADA, name: "Ada Lovelace", tenant_id: WORK_TENANT },
      { email: GRACE, name: "Grace Hopper", tenant_id: WORK_TENANT },
    ],
    oauth_clients: [
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        name: "Acme Sync",
        redirect_uris: ["https://app.danwo.test/callback"],
      },
    ],
    ...seed,
  })

  return emulator
}

/** Tokens for `email` with `scope`, as the token endpoint would issue them. */
export function tokensFor(emulator: Emulator, email: string, scope: string) {
  const graph = microsoftStore(emulator.store)
  const user = graph.users.findOneBy("email", email)

  if (!user) throw new Error(`no user ${email}`)

  const grant = { clientId: CLIENT_ID, user: user.oid, scope }
  const refresh = issueRefreshToken(graph.tokens, grant, "1.A")
  const access = issueAccessToken(graph.tokens, grant, {
    prefix: "EwA",
    clock: emulator.store.clock,
    parent: refresh.token,
  })

  return { access: access.token, refresh: refresh.token, oid: user.oid }
}

/** The official Graph client, signed in as `email` with `scope`, talking to the emulator. */
export function graphClient(emulator: Emulator, email: string, scope: string): Client {
  const { access } = tokensFor(emulator, email, scope)
  const chain: Middleware[] = [
    new AuthenticationHandler({ getAccessToken: () => Promise.resolve(access) }),
    new RetryHandler(new RetryHandlerOptions(0, 0)),
    new RedirectHandler(),
    new EmulatorHandler(emulator),
  ]

  return Client.initWithMiddleware({ middleware: chain, defaultVersion: "v1.0" })
}

/** A plain request to the emulator with a bearer token, for status and header checks. */
export function graphFetch(
  emulator: Emulator,
  token: string,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)

  headers.set("authorization", `Bearer ${token}`)

  return emulator.fetch(new Request(`https://graph.microsoft.com${path}`, { ...init, headers }))
}
