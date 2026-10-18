import type { SessionJSON } from "@clerk/backend"

import type { Emulator } from "../define.ts"
import { waitUntil } from "../poll.ts"
import { contextOf, instanceOf } from "./context.ts"
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
}

/** The Clerk emulator's instance, users, sessions and sent codes, for tests. */
export function clerkInstance(emulator: Emulator): ClerkInstanceView {
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
      waitUntil(() => messages(to).at(-1)?.code ?? undefined, timeoutMs, `no Clerk code was emailed to ${to}`),
  }
}
