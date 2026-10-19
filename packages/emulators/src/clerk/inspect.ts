import type { OrganizationJSON, SessionJSON } from "@clerk/backend"

import type { Emulator } from "../define.ts"
import { waitUntil } from "../poll.ts"
import { type ClerkContext, contextOf, instanceOf, signingKeyOf } from "./context.ts"
import type { ClerkUser } from "./entities.ts"
import { userByEmail } from "./routes/users.ts"
import { endSession } from "./sessions.ts"
import type { ClerkInstance, ClerkMessage } from "./store.ts"

/** What a test can read and do on a Clerk emulator. */
export interface ClerkInstanceView {
  /** The instance's slug, hosts and keys: hand `publishableKey` and `secretKey` to the app. */
  readonly instance: ClerkInstance & { readonly secretKey: string }
  user(email: string): ClerkUser | undefined
  /** The user's sessions, oldest first. */
  sessions(email: string): SessionJSON[]
  /** Revokes every active session of the user, as signing them out everywhere does. */
  revokeSessions(email: string): number
  /** The emails sent to `to`, oldest first. */
  messages(to: string): ClerkMessage[]
  /** The newest code emailed to `to`, waiting up to `timeoutMs` for one to arrive. */
  code(to: string, timeoutMs?: number): Promise<string>
  /** The organizations, oldest first. */
  organizations(): OrganizationJSON[]
  /**
   * The public key session tokens are signed with, as a PEM: what an app that verifies tokens
   * offline is configured with (`CLERK_PEM_PUBLIC_KEY`, `CLERK_JWT_KEY`, `jwtKey`).
   */
  publicKeyPem(): string
  /** The `whsec_` secret webhooks to `endpoint` (or the only endpoint) are signed with. */
  webhookSecret(endpoint?: string): string
  /**
   * The environment an app's Clerk SDKs read: the publishable and secret keys (also with the
   * `VITE_` and `NEXT_PUBLIC_` prefixes), the public key PEM for offline verification and the
   * webhook signing secret when one endpoint is seeded.
   */
  env(): Record<string, string>
}

/** The Clerk emulator's instance, users, sessions and sent codes, for tests. */
export function clerkInstance(emulator: Pick<Emulator, "store">): ClerkInstanceView {
  const context = contextOf(emulator.store)

  const userSessions = (email: string) => {
    const user = userByEmail(context, email)

    return user ? context.clerk.sessions.where((s) => s.user_id === user.id) : []
  }

  const messages = (to: string) =>
    context.clerk.messages.where((m) => m.to.toLowerCase() === to.toLowerCase())

  return {
    get instance() {
      const instance = instanceOf(context)

      return { ...instance, secretKey: instance.secretKeys[0] ?? "" }
    },
    user: (email) => userByEmail(context, email),
    sessions: userSessions,
    revokeSessions(email) {
      const live = userSessions(email).filter((s) => s.status === "active")

      for (const session of live) endSession(context, session.id, "revoked")

      return live.length
    },
    messages,
    code: (to, timeoutMs = 5000) =>
      waitUntil(
        () => messages(to).at(-1)?.code ?? undefined,
        timeoutMs,
        `no Clerk code was emailed to ${to}`,
      ),
    organizations: () => context.clerk.organizations.all(),
    publicKeyPem: () => signingKeyOf(context).pem,
    webhookSecret: (endpoint) => webhookSecretOf(context, endpoint),
    env: () => clerkEnv(context),
  }
}

/** The signing secret of `endpoint`, or of the only seeded endpoint. */
function webhookSecretOf(context: ClerkContext, endpoint: string | undefined): string {
  const hooks = context.clerk.webhooks.where((h) => endpoint === undefined || h.url === endpoint)

  if (hooks.length !== 1)
    throw new Error(
      endpoint === undefined
        ? `the Clerk emulator has ${hooks.length} webhook endpoints; name one`
        : `the Clerk emulator has no webhook endpoint ${endpoint}`,
    )

  return hooks[0]?.secret ?? ""
}

/** The variables an app's Clerk SDKs read, for this emulator. */
function clerkEnv(context: ClerkContext): Record<string, string> {
  const instance = instanceOf(context)
  const publishable = instance.publishableKey
  const hooks = context.clerk.webhooks.all()

  return {
    CLERK_PUBLISHABLE_KEY: publishable,
    VITE_CLERK_PUBLISHABLE_KEY: publishable,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
    CLERK_SECRET_KEY: instance.secretKeys[0] ?? "",
    CLERK_PEM_PUBLIC_KEY: signingKeyOf(context).pem,
    CLERK_JWT_KEY: signingKeyOf(context).pem,
    ...(hooks.length === 1 && { CLERK_WEBHOOK_SIGNING_SECRET: hooks[0]?.secret ?? "" }),
  }
}
