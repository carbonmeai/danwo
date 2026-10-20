/**
 * The `users` fixture: other people's browsers in one test, for flows two people take part in (a
 * teammate who should see a change live, a buyer and a seller). Each person gets a browser context
 * of their own in the test's browser, signed out or in one of the worker's saved sessions.
 */
import type { BrowserState, WebSession } from "../session.ts"
import { DanwoError } from "../support/codes.ts"
import type { Users } from "../tests/types.ts"
import { type SessionContext, SessionKeeper, startingState } from "./sessions.ts"

/**
 * The browser state saved session `name` starts a person in. A sign-in the worker already keeps
 * is reused; otherwise the session is set up now, for this test alone, and not kept: kept in the
 * middle of a test, it would outlive the reset that ends the test, which forgets the sign-in.
 */
async function savedState(
  name: string,
  sessions: SessionContext | undefined,
): Promise<BrowserState> {
  if (sessions === undefined) {
    throw new DanwoError(
      "CONFIG_INVALID",
      `users.open: saved session "${name}" is not available here`,
    )
  }

  const kept = sessions.keeper.get(name)

  if (kept !== undefined) return kept

  const started = await startingState(name, { ...sessions, keeper: new SessionKeeper() })

  if (started.error !== undefined) throw started.error

  if (started.state === undefined) {
    throw new DanwoError("SESSION_SETUP_FAILED", `session "${name}" left no browser state`)
  }

  return started.state
}

/** The `users` fixture of a test on `session`; saved sessions are looked up through `sessions`. */
export function usersFixture(session: WebSession, sessions?: SessionContext): Users {
  return {
    open: async (name, options = {}) => {
      if (options.session === undefined) return session.openUser(name)

      return session.openUser(name, { state: await savedState(options.session, sessions) })
    },
  }
}
