import type { Emulator } from "../define.ts"
import { roleNames } from "./claims.ts"
import type { Auth0EmailRecord, Auth0LoginRecord } from "./entities.ts"
import { auth0Store } from "./store.ts"
import { userView } from "./users.ts"

/** A user as a test reads it: the Management API's view plus their role names. */
export type Auth0UserView = ReturnType<typeof userView> & { readonly roles: readonly string[] }

/** One login, as a test reads it. */
export interface Auth0LoginView {
  readonly email: string
  readonly clientId: string
  /** `password`, `signup`, `silent` (`prompt=none`) or a social connection's name. */
  readonly method: string
  readonly mfa: boolean
  readonly at: string
}

/** What a tenant holds and has done, for tests. */
export interface Auth0Tenant {
  /** The tenant's users, in creation order. */
  users(): Auth0UserView[]
  /** One user by email. */
  user(email: string): Auth0UserView | undefined
  /** Logins, newest first; only `email`'s when given. */
  logins(email?: string): Auth0LoginView[]
  /** Refresh tokens issued and still live, by client. */
  liveRefreshTokens(clientId?: string): number
  /** Emails the tenant sent (verification emails), newest first. */
  emails(to?: string): Pick<Auth0EmailRecord, "to" | "kind" | "link" | "used">[]
  /** Blocks or unblocks a user, as an admin would from the dashboard. */
  block(email: string, blocked?: boolean): void
}

const loginView = (login: Auth0LoginRecord, email: string): Auth0LoginView => ({
  email,
  clientId: login.client_id,
  method: login.method,
  mfa: login.mfa,
  at: login.created_at,
})

/** What `domain`'s tenant holds and has done; the first tenant when no domain is given. */
export function auth0Tenant(emulator: Pick<Emulator, "store">, domain?: string): Auth0Tenant {
  const auth0 = () => auth0Store(emulator.store)
  const tenantDomain = () => domain?.toLowerCase() ?? auth0().tenants.all()[0]?.domain ?? ""
  const own = () =>
    auth0()
      .users.all()
      .filter((user) => user.tenant === tenantDomain())
  const emailOf = (userId: string) => auth0().users.findOneBy("user_id", userId)?.email ?? userId

  return {
    users: () => own().map((user) => ({ ...userView(user), roles: roleNames(auth0(), user) })),
    user(email) {
      const found = own().find((user) => user.email === email.toLowerCase())

      return found && { ...userView(found), roles: roleNames(auth0(), found) }
    },
    logins: (email) =>
      auth0()
        .logins.all()
        .filter((login) => login.tenant === tenantDomain())
        .map((login) => loginView(login, emailOf(login.user_id)))
        .filter((login) => email === undefined || login.email === email.toLowerCase())
        .toReversed(),
    liveRefreshTokens: (clientId) =>
      auth0()
        .refreshTokens.all()
        .filter(
          (token) =>
            token.tenant === tenantDomain() &&
            !token.revoked &&
            token.rotatedAt === null &&
            (clientId === undefined || token.client_id === clientId),
        ).length,
    emails: (to) =>
      auth0()
        .emails.all()
        .filter(
          (email) =>
            email.tenant === tenantDomain() && (to === undefined || email.to === to.toLowerCase()),
        )
        .map(({ to: address, kind, link, used }) => ({ to: address, kind, link, used }))
        .toReversed(),
    block(email, blocked = true) {
      const found = own().find((user) => user.email === email.toLowerCase())

      if (found) auth0().users.update(found.id, { blocked })
    },
  }
}
