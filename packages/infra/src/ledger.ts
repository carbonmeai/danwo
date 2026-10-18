/** The log of calls a data proxy saw, and how each one ended. */
import type { DataCall, DataCallStart, DataFault } from "./types.ts"

/** One call being tracked: its start, when it began, and how it ended so far. */
interface Entry {
  readonly start: DataCallStart
  readonly startedAt: number
  outcome: DataCall["outcome"]
  ended: number | null
  error?: string
  fault: string | null
}

/** A handle to a call in the ledger, to settle it once the server answers or the line drops. */
export interface CallHandle {
  answered(error?: string): void
  dropped(): void
}

export class Ledger {
  #entries: Entry[] = []

  /** Records a call as sent, with the fault put on it, and returns a handle to settle it. */
  begin(start: DataCallStart, fault: DataFault | undefined, label: string | null): CallHandle {
    const entry: Entry = {
      start,
      startedAt: Date.now(),
      outcome: "pending",
      ended: null,
      fault: fault === undefined ? null : label,
    }

    this.#entries.push(entry)

    return {
      answered: (error) => {
        if (entry.outcome !== "pending") return

        entry.outcome = error === undefined ? "ok" : "error"
        entry.ended = Date.now()
        if (error !== undefined) entry.error = error
      },
      dropped: () => {
        if (entry.outcome === "pending") entry.outcome = "reset"
      },
    }
  }

  calls(): DataCall[] {
    return this.#entries.map((entry) => ({
      ...entry.start,
      startedAt: new Date(entry.startedAt).toISOString(),
      durationMs: entry.ended === null ? null : entry.ended - entry.startedAt,
      outcome: entry.outcome,
      ...(entry.error !== undefined && { error: entry.error }),
      fault: entry.fault,
    }))
  }

  clear(): void {
    this.#entries = []
  }
}
