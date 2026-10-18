import type { IssuedCode, OAuthTables } from "./pkce.ts"

/** One account chosen on the sign-in page, as a test reads it. */
export interface SignIn {
  /** The signed-in user's email. */
  readonly email: string
  readonly clientId: string
  readonly scope: string
  /** Whether the app exchanged the code at the token endpoint. */
  readonly redeemed: boolean
  /** Access tokens issued to this client for this user so far (code exchange and refreshes). */
  readonly accessTokens: number
  readonly createdAt: string
}

/** Who signed in to which OAuth client, as `googleSignIns` and `microsoftSignIns` read it. */
export interface SignIns {
  /** Sign-ins, newest first; only those for `clientId` when given. */
  list(clientId?: string): SignIn[]
  /** The newest sign-in, for `clientId` when given. */
  latest(clientId?: string): SignIn | undefined
}

/** Reads which users signed in to which client from a provider's codes and tokens. */
export function signIns(
  tables: () => OAuthTables,
  emailOf: (user: string) => string | undefined,
): SignIns {
  const describe = (code: IssuedCode, all: OAuthTables): SignIn => ({
    email: emailOf(code.user) ?? code.user,
    clientId: code.params.client_id,
    scope: code.params.scope,
    redeemed: code.used,
    accessTokens: all.tokens.count(
      (token) =>
        token.kind === "access" &&
        token.clientId === code.params.client_id &&
        token.user === code.user,
    ),
    createdAt: code.created_at,
  })

  const list = (clientId?: string) => {
    const all = tables()

    return all.codes
      .all()
      .filter((code) => clientId === undefined || code.params.client_id === clientId)
      .toReversed()
      .map((code) => describe(code, all))
  }

  return { list, latest: (clientId) => list(clientId)[0] }
}
