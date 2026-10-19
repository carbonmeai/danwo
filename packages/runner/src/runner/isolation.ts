/**
 * Where each test and matrix trial starts. A worker's environment is reset once, kept as a
 * snapshot, and restored before every test (or file, or trial) after that, so no test sees what
 * an earlier one left in the emulators, the clock, the proxy's log or the app's data stores.
 * Setup work meant to outlive a test is kept on top: a file's `beforeAll` hooks and the backend
 * side of saved sessions.
 */
import type { WorkerEnvironment } from "./environment.ts"

/**
 * How much state tests share: `test` (default) starts every test, and every retry, from the
 * environment's seeded state; `file` starts every file from it and lets a file's tests build on
 * one another; `none` never resets, so state carries from file to file in a worker.
 */
export type Isolation = "test" | "file" | "none"

export const ISOLATION_MODES: readonly Isolation[] = ["test", "file", "none"]

/** What the starting point needs from the environment: its reset and, optionally, a snapshot. */
type Resettable = Pick<WorkerEnvironment, "reset" | "snapshot" | "restore">

/**
 * One worker's starting point. `clean` goes back to the seeded state (plus saved sessions);
 * `again` goes back to the last kept point, which a file's setup may have moved; `keep` makes the
 * state now the point to come back to. An environment without `snapshot` and `restore` is reset
 * instead, which also forgets saved sessions (`onReset`).
 */
export class StartingPoint {
  readonly #env: Resettable
  readonly #onReset: () => void
  /** A snapshot was taken and `restore` returns to it. */
  #kept = false
  /** The kept snapshot holds a file's setup, so it is not the clean state any more. */
  #holdsFile = false

  constructor(env: Resettable, onReset: () => void) {
    this.#env = env
    this.#onReset = onReset
  }

  /** Whether the environment can return to a kept state without a full reset. */
  get keeps(): boolean {
    return this.#env.snapshot !== undefined && this.#env.restore !== undefined
  }

  /** Back to the seeded state, saved sessions kept when the environment can keep them. */
  async clean(): Promise<void> {
    if (this.#kept && !this.#holdsFile) return this.#env.restore?.()

    await this.#reset()
    if (!this.keeps) return

    await this.#env.snapshot?.()
    this.#kept = true
  }

  /** Back to the last kept point: the clean state, or the file's setup on top of it. */
  async again(): Promise<void> {
    if (this.#kept) return this.#env.restore?.()

    await this.#reset()
  }

  /**
   * Keeps the state now as the point `again` returns to: after a file's `beforeAll` (`file`), or
   * after a saved session signed in (`session`, which the next files keep too).
   */
  async keep(what: "file" | "session"): Promise<void> {
    if (!this.keeps) return

    await this.#env.snapshot?.()
    this.#kept = true
    if (what === "file") this.#holdsFile = true
  }

  /** Whether the environment can be reset at all; one without `reset` keeps whatever it holds. */
  get resets(): boolean {
    return this.#env.reset !== undefined
  }

  async #reset(): Promise<void> {
    if (!this.resets) return

    await this.#env.reset?.()
    this.#kept = false
    this.#holdsFile = false
    this.#onReset()
  }
}
