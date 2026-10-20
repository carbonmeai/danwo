/**
 * The cleanup ledger: every object a scenario makes in a provider's sandbox is written down with
 * how to undo it (delete, archive, cancel, revoke), and the ledger undoes them newest first when the
 * scenario ends, whether it finished, failed or threw, and when the run is interrupted. What it
 * could not undo is reported as left behind, by kind and id only.
 */
import { redactCredentials } from "@danwo/runner"

/** The marker every object a live run makes carries, in a name, an email tag or an external id. */
export const FIDELITY_TAG = "danwo-fidelity"

/** Something a scenario made, and how to take it away again. */
export interface Created {
  /** What it is, such as `customer` or `organization`. */
  readonly kind: string
  readonly id: string
  /** Sends the undo. It counts as done on a 2xx, a 404 or a 410, or when `settled` says so. */
  readonly undo: () => Promise<Response>
  /**
   * Whether an answer that is not a success still means the object needs nothing more: an
   * already-canceled subscription, a setup intent that already succeeded.
   */
  readonly settled?: (status: number, body: string) => boolean
  /**
   * Why the provider gives no way to remove it, such as a trial account's sent message. Nothing is
   * tried: it is reported as kept by the provider, which does not fail the run the way an undo
   * that went wrong does.
   */
  readonly unremovable?: string
}

/** The reason a {@link LeftBehind} carries when its provider cannot remove it. */
export const UNREMOVABLE = "cannot be removed: "

/** An object the ledger could not undo, or was told to keep. */
export interface LeftBehind {
  readonly kind: string
  readonly id: string
  /** Why: the undo's status and a short, redacted reason, or `kept`. */
  readonly reason: string
}

/** How long one undo may take before it counts as failed. */
const UNDO_TIMEOUT_MS = 20_000

function finished(created: Created, status: number, body: string): boolean {
  if ((status >= 200 && status < 300) || status === 404 || status === 410) return true

  return created.settled?.(status, body) === true
}

/** One undo, as done or the reason it was not. */
async function attempt(created: Created): Promise<string | undefined> {
  try {
    const response = await created.undo()
    const body = await response.text()

    if (finished(created, response.status, body)) return undefined

    return `${response.status} ${redactCredentials(body).replace(/\s+/g, " ").slice(0, 120)}`
  } catch (error) {
    return redactCredentials(error instanceof Error ? error.message : String(error)).slice(0, 120)
  }
}

/** Every ledger with undos still pending, so an interrupt can drain them. */
const open = new Set<CleanupLedger>()

/** The undos one scenario run registered. */
export class CleanupLedger {
  #entries: Created[] = []
  #undone = 0

  constructor() {
    open.add(this)
  }

  /** How many objects the ledger has undone so far. */
  get undone(): number {
    return this.#undone
  }

  /** Writes down something made, to undo later. */
  add(created: Created): void {
    this.#entries.push(created)
  }

  /** Everything still to undo, as kept: for `--keep`, which leaves the sandbox as the run left it. */
  keep(): LeftBehind[] {
    const kept = this.#entries.map(({ kind, id }) => ({ kind, id, reason: "kept" }))

    this.#entries = []
    open.delete(this)

    return kept
  }

  /** Undoes everything newest first, each tried twice; what still stands is returned. */
  async drain(): Promise<LeftBehind[]> {
    const entries = this.#entries.toReversed()
    const left: LeftBehind[] = []

    this.#entries = []

    for (const created of entries) {
      if (created.unremovable !== undefined) {
        left.push({ kind: created.kind, id: created.id, reason: UNREMOVABLE + created.unremovable })
        continue
      }

      const reason = await withTimeout(attempt(created))
      const retried = reason === undefined ? undefined : await withTimeout(attempt(created))

      if (reason !== undefined && retried !== undefined)
        left.push({ kind: created.kind, id: created.id, reason: retried })
      else this.#undone++
    }

    open.delete(this)

    return left
  }
}

async function withTimeout(work: Promise<string | undefined>): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<string>((done) => {
    timer = setTimeout(() => done(`no answer in ${UNDO_TIMEOUT_MS / 1000} s`), UNDO_TIMEOUT_MS)
  })

  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Undoes everything every open ledger holds, as an interrupted run's last act. */
async function drainOpenLedgers(): Promise<LeftBehind[]> {
  const left: LeftBehind[] = []

  for (const ledger of open) left.push(...(await ledger.drain()))

  return left
}

/**
 * While a live run is going, Ctrl-C (SIGINT) and SIGTERM undo what is still open before the
 * process exits, printing anything left behind with `write`. Returns the function that removes the
 * handlers again.
 */
export function cleanUpOnInterrupt(write: (line: string) => void): () => void {
  let draining = false

  const handler = (signal: NodeJS.Signals): void => {
    if (draining) return

    draining = true

    write(`${signal}: undoing what this run made in the sandboxes`)
    void drainOpenLedgers().then((left) => {
      for (const line of leftBehindLines("interrupted run", left)) write(line)

      process.exit(signal === "SIGINT" ? 130 : 143)
    })
  }

  process.on("SIGINT", handler)
  process.on("SIGTERM", handler)

  return () => {
    process.off("SIGINT", handler)
    process.off("SIGTERM", handler)
  }
}

/** A "left behind" section for a terminal, or nothing when the list is empty. */
export function leftBehindLines(where: string, left: readonly LeftBehind[]): string[] {
  if (left.length === 0) return []

  return [
    `  left behind (${where}):`,
    ...left.map((item) => `    ${item.kind} ${item.id}: ${item.reason}`),
  ]
}
