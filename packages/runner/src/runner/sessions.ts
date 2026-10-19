/**
 * Saved sessions in a worker. A session's setup signs in once in a browser of its own; the
 * browser state it leaves (cookies, localStorage, IndexedDB) is kept, and every test that names
 * the session starts its own fresh browser from that state. Resetting the environment resets the
 * app, so the kept states are dropped then and each session is set up again on its next use.
 */
import type { BrowserState, WebSession } from "../session.ts"
import { DanwoError } from "../support/codes.ts"
import { withDeadline } from "../support/deadline.ts"
import type { SessionArgs, SessionDefinition, SessionSetup } from "../tests/types.ts"

type Definition = SessionDefinition<SessionArgs>

/** The kept states of one worker's saved sessions, by name. */
export class SessionKeeper {
  readonly #states = new Map<string, BrowserState>()
  /** Setups that failed since the last reset; the next tests fail with the same reason at once. */
  readonly #failures = new Map<string, unknown>()
  /** Told after a setup signs in, so the backend side of the sign-in can be kept too. */
  readonly #onSignedIn: () => Promise<void>

  constructor(onSignedIn: () => Promise<void> = async () => {}) {
    this.#onSignedIn = onSignedIn
  }

  /** A setup signed in and its browser state was kept; the backend's side is kept next. */
  signedIn(): Promise<void> {
    return this.#onSignedIn()
  }

  /** The state `name` left last time, unless the environment was reset since. */
  get(name: string): BrowserState | undefined {
    return this.#states.get(name)
  }

  /** Why `name`'s setup failed, if it did since the last reset. */
  failure(name: string): unknown {
    return this.#failures.get(name)
  }

  keep(name: string, state: BrowserState): void {
    this.#states.set(name, state)
  }

  fail(name: string, cause: unknown): void {
    this.#states.delete(name)
    this.#failures.set(name, cause)
  }

  /** The environment was reset: the app knows none of the kept sign-ins any more. */
  invalidate(): void {
    this.#states.clear()
    this.#failures.clear()
  }
}

/**
 * A session whose setup threw or whose name is unknown; the tests that use it fail with it. Its
 * stack is the setup's, so the failure points at the setup's line.
 */
class SessionSetupFailed extends DanwoError {
  constructor(name: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)

    super("SESSION_SETUP_FAILED", `session "${name}" could not be set up: ${reason}`, { cause })
    this.name = "SessionSetupFailed"

    const frames = cause instanceof Error ? cause.stack?.split("\n").slice(1) : undefined

    if (frames !== undefined) this.stack = [`${this.name}: ${this.message}`, ...frames].join("\n")
  }
}

/** What setting up or checking a session needs from the attempt that wants it. */
export interface SessionContext {
  readonly keeper: SessionKeeper
  /** The definition of a session name: the test file's, else the config's. */
  readonly definition: (name: string) => Definition | undefined
  /** A fresh browser session whose recorded steps replay under `journey`. */
  readonly open: (journey: string) => Promise<WebSession>
  /** Calls a setup or check with a browser session's fixtures. */
  readonly call: (fn: SessionSetup<SessionArgs>, web: WebSession) => Promise<unknown>
  /** How long a setup may take, in milliseconds. */
  readonly deadline: number
}

/** The state a test starts in, and what to say about it in its flight record. */
export interface StartingState {
  readonly state: BrowserState | undefined
  /** Whether the state was kept from an earlier test; only a reused state is checked. */
  readonly reused: boolean
  readonly check: SessionSetup<SessionArgs> | undefined
  readonly note: string
  /** The reason the session could not be set up; the test fails with it. */
  readonly error: SessionSetupFailed | undefined
}

/** A session's setup and optional check, whichever way it was defined. */
function partsOf(definition: Definition) {
  return typeof definition === "function"
    ? { setup: definition, check: undefined }
    : { setup: definition.setup, check: definition.check }
}

function failed(name: string, cause: unknown): StartingState {
  return {
    state: undefined,
    reused: false,
    check: undefined,
    note: `session ${name}: setup failed`,
    error: new SessionSetupFailed(name, cause),
  }
}

/** Runs the setup in a browser of its own and returns the state it left, and how many steps it took. */
async function signIn(
  name: string,
  setup: SessionSetup<SessionArgs>,
  context: SessionContext,
): Promise<{ state: BrowserState; steps: number }> {
  const web = await context.open(`session/${name}`)

  try {
    await withDeadline(() => context.call(setup, web), context.deadline, `session ${name}`)

    const diverged = web.divergence()

    if (diverged !== undefined) {
      throw new Error(`setup diverged at step ${diverged.step} (${diverged.instruction})`)
    }

    return { state: await web.browserState(), steps: web.flight.steps().length }
  } finally {
    await web.close()
  }
}

/**
 * The state a test that names `name` starts in: the kept one, or a new one from running the
 * session's setup. `fresh` skips the kept state (its check failed).
 */
export async function startingState(
  name: string,
  context: SessionContext,
  fresh = false,
): Promise<StartingState> {
  const definition = context.definition(name)

  if (definition === undefined) {
    return failed(name, new Error("no such session; define it with test.session() or in sessions"))
  }

  const { setup, check } = partsOf(definition)
  const earlier = context.keeper.failure(name)

  if (earlier !== undefined) return failed(name, earlier)

  const kept = fresh ? undefined : context.keeper.get(name)

  if (kept !== undefined) {
    return { state: kept, reused: true, check, note: `session ${name}: reused`, error: undefined }
  }

  try {
    const { state, steps } = await signIn(name, setup, context)

    context.keeper.keep(name, state)
    await context.keeper.signedIn()

    const note = `session ${name}: ${fresh ? "renewed" : "created"} (${steps} steps)`

    return { state, reused: false, check, note, error: undefined }
  } catch (cause) {
    context.keeper.fail(name, cause)

    return failed(name, cause)
  }
}
