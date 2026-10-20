/**
 * Where each test and matrix trial starts. A worker's environment is reset once, kept as the
 * pristine snapshot, and restored before every test (or file, or trial) after that, so no test
 * sees what an earlier one left in the emulators, the clock, the proxy's log or the app's data
 * stores. Setup work meant to outlive a test is kept beside it: a file's `beforeAll` hooks, and
 * each saved session's sign-in. A test that names a session starts from that session's own kept
 * state; one that names none starts from the pristine (or file's) state, never another test's
 * sign-in.
 */
import type { WorkerEnvironment } from "./environment.ts"

/**
 * How much state tests share: `test` (default) starts every test, and every retry, from the
 * environment's seeded state; `file` starts every file from it and lets a file's tests build on
 * one another; `none` never resets, so state carries from file to file in a worker.
 */
export type Isolation = "test" | "file" | "none"

/** What the starting point needs from the environment: its reset and, optionally, snapshots. */
type Resettable = Pick<WorkerEnvironment, "reset" | "snapshot" | "restore" | "snapshotSlots">

/** The state a base starts from: the seeded one, or a file's setup on top of it. */
type Base = "pristine" | "file"

/** The slot a session's sign-in on `base` is kept in. */
function sessionSlot(base: Base, session: string): string {
  return `${base}+${session}`
}

/**
 * One worker's starting point. `clean` goes back to the seeded state; `again` goes back to the
 * current base (the seeded state, or the file's setup), or to the kept sign-in of the session
 * a test names; `keep` keeps a file's setup or a session's sign-in to come back to. An
 * environment without `snapshot` and `restore` is reset instead, which also forgets saved
 * sessions (`onReset`). One whose snapshots keep a single state (no `snapshotSlots`) keeps only
 * the base, so a session signs in again for each test that names it.
 */
export class StartingPoint {
  readonly #env: Resettable
  readonly #onReset: () => void
  #base: Base = "pristine"
  /** Kept slots, and the sessions signed in in each. */
  readonly #kept = new Map<string, ReadonlySet<string>>()
  /** The slot the environment is at, untouched since it got there; undefined once anything ran. */
  #at: string | undefined
  /** Sessions whose sign-in the environment holds now, so their kept browser states still work. */
  #present = new Set<string>()

  constructor(env: Resettable, onReset: () => void) {
    this.#env = env
    this.#onReset = onReset
  }

  /** Whether the environment can return to a kept state without a full reset. */
  get keeps(): boolean {
    return this.#env.snapshot !== undefined && this.#env.restore !== undefined
  }

  /** Whether the environment keeps a state per slot, so sessions are kept beside the base. */
  get slots(): boolean {
    return this.keeps && this.#env.snapshotSlots === true
  }

  /** Whether the environment can be reset at all; one without `reset` keeps whatever it holds. */
  get resets(): boolean {
    return this.#env.reset !== undefined
  }

  /** Whether nothing ran since the environment was put at a starting point. */
  get untouched(): boolean {
    return this.#at !== undefined
  }

  /** Whether the environment holds `session`'s sign-in now, so a kept browser state for it works. */
  holds(session: string): boolean {
    return this.#present.has(session)
  }

  /** Something ran in the environment: the next `again` restores even to the same point. */
  touch(): void {
    this.#at = undefined
  }

  /** A session signed in: the environment holds it until the next restore or reset. */
  signedIn(session: string): void {
    this.#present.add(session)
  }

  /**
   * Back to the seeded state, forgetting a file's setup. With `session`, to that session's kept
   * sign-in on the seeded state when there is one.
   */
  async clean(session?: string): Promise<void> {
    if (this.#base === "file") {
      this.#base = "pristine"
      this.#forgetFile()
      // A single kept state holds the file's setup; only a reset gets back to the seeded one.
      if (!this.slots) await this.#fresh()
    }

    if (!this.#kept.has("pristine")) await this.#fresh()

    await this.again(session)
  }

  /** Back to the current base, or to `session`'s kept sign-in on it when there is one. */
  async again(session?: string): Promise<void> {
    const slot = this.#slotFor(session) ?? SEEDED

    if (this.#at === slot) return
    if (slot === SEEDED) await this.#reset()
    else await this.#restore(slot)
  }

  /**
   * Keeps the state now as the point `again` returns to after a file's `beforeAll` (`file`), or
   * keeps `session`'s sign-in beside the base for the tests that name it (`session`).
   */
  async keep(what: "file"): Promise<void>
  async keep(what: "session", session: string): Promise<void>
  async keep(what: "file" | "session", session?: string): Promise<void> {
    if (!this.keeps) return

    if (what === "file") {
      this.#base = "file"
      this.#forgetFile()
      await this.#snapshot("file")

      return
    }

    if (session === undefined || !this.slots) return

    this.#present.add(session)
    await this.#snapshot(sessionSlot(this.#base, session))
    // A sign-in is kept in the middle of an attempt, which goes on changing the state after it.
    this.#at = undefined
  }

  /** The slot `again` would restore for `session`: its kept sign-in, else the base, if kept. */
  #slotFor(session: string | undefined): string | undefined {
    const signedIn = session === undefined ? undefined : sessionSlot(this.#base, session)

    if (signedIn !== undefined && this.#kept.has(signedIn)) return signedIn

    return this.#kept.has(this.#base) ? this.#base : undefined
  }

  /** Resets and, when the environment keeps snapshots, keeps the pristine state. */
  async #fresh(): Promise<void> {
    await this.#reset()
    if (this.keeps) await this.#snapshot("pristine")
  }

  async #snapshot(slot: string): Promise<void> {
    await (this.slots ? this.#env.snapshot?.(slot) : this.#env.snapshot?.())
    // A single kept state is overwritten by every snapshot: only the newest slot is still kept.
    if (!this.slots) this.#kept.clear()
    this.#kept.set(slot, new Set(this.#present))
    this.#at = slot
  }

  async #restore(slot: string): Promise<void> {
    await (this.slots ? this.#env.restore?.(slot) : this.#env.restore?.())
    this.#present = new Set(this.#kept.get(slot))
    this.#at = slot
  }

  /** Drops the file's slot and every sign-in kept on it: they belong to the file that ended. */
  #forgetFile(): void {
    for (const slot of this.#kept.keys()) if (slot.startsWith("file")) this.#kept.delete(slot)
  }

  /** Resets the environment, when it can, to its seeded state; an environment that cannot stays as it is. */
  async #reset(): Promise<void> {
    this.#at = SEEDED
    if (!this.resets) return

    await this.#env.reset?.()
    // A reset takes the app back to its seed: no sign-in survives, and no kept state is current.
    this.#present.clear()
    this.#kept.clear()
    this.#base = "pristine"
    this.#onReset()
  }
}

/** Where `again` is after a reset with nothing kept: the seeded state, unkept. */
const SEEDED = "seeded"
