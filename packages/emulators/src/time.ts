import type { Clock } from "./store.ts"

/** Schedules callbacks. Emulators take one so a test can run retries without waiting. */
export interface Timer {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** What `systemTimer` hands out: a way to cancel the timeout it started. */
interface SystemHandle {
  readonly cancel: () => void
}

function isSystemHandle(handle: unknown): handle is SystemHandle {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "cancel" in handle &&
    typeof handle.cancel === "function"
  )
}

export const systemTimer: Timer = {
  setTimeout: (callback, ms): SystemHandle => {
    const timeout = setTimeout(callback, ms)

    return { cancel: () => clearTimeout(timeout) }
  },
  clearTimeout: (handle) => {
    if (isSystemHandle(handle)) handle.cancel()
  },
}

interface Pending {
  readonly id: number
  readonly at: number
  readonly callback: () => void
}

/**
 * A clock and timer that only move when told to. `advance` moves time forward and runs every
 * callback that falls due, in time order, including ones scheduled while advancing.
 */
export class ManualClock {
  private nowMs: number
  private queue: Pending[] = []
  private nextId = 1

  constructor(start: Date) {
    this.nowMs = start.getTime()
  }

  readonly clock: Clock = () => new Date(this.nowMs)

  readonly timer: Timer = {
    setTimeout: (callback, ms) => {
      const id = this.nextId++

      this.queue.push({ id, at: this.nowMs + Math.max(0, ms), callback })

      return id
    },
    clearTimeout: (handle) => {
      this.queue = this.queue.filter((p) => p.id !== handle)
    },
  }

  /** Moves time forward by `ms`, running callbacks as they fall due. */
  advance(ms: number): void {
    const target = this.nowMs + ms

    for (;;) {
      const due = this.queue
        .filter((p) => p.at <= target)
        .toSorted((a, b) => a.at - b.at || a.id - b.id)[0]

      if (!due) break
      this.queue = this.queue.filter((p) => p.id !== due.id)
      this.nowMs = Math.max(this.nowMs, due.at)
      due.callback()
    }

    this.nowMs = target
  }

  /** Milliseconds until the next scheduled callback, or undefined if none. */
  nextIn(): number | undefined {
    const next = this.queue.reduce<number | undefined>(
      (min, p) => (min === undefined || p.at < min ? p.at : min),
      undefined,
    )

    return next === undefined ? undefined : Math.max(0, next - this.nowMs)
  }
}
