import type { Clock } from "./store.ts"

/**
 * Schedules callbacks. Emulators take one so a test can run retries without waiting. A
 * `background` callback (a renewal weeks away) never keeps the process alive on its own.
 */
export interface Timer {
  setTimeout(callback: () => void, ms: number, options?: { readonly background?: boolean }): unknown
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

/** The longest delay a Node timer takes; longer ones are waited out in steps. */
const LONGEST_TIMEOUT_MS = 2 ** 31 - 1

export const systemTimer: Timer = {
  setTimeout: (callback, ms, options): SystemHandle => {
    let timeout: ReturnType<typeof setTimeout>

    const wait = (left: number) => {
      timeout = setTimeout(
        () => (left > LONGEST_TIMEOUT_MS ? wait(left - LONGEST_TIMEOUT_MS) : callback()),
        Math.min(left, LONGEST_TIMEOUT_MS),
      )
      if (options?.background === true) timeout.unref()
    }

    wait(ms)

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
  private travelledMs = 0

  constructor(start: Date) {
    this.nowMs = start.getTime()
  }

  readonly clock: Clock = () => new Date(this.nowMs)

  /**
   * Real time as the apps see it once time travel has moved their clocks: the system clock plus
   * every `travelled` jump. Signatures apps check against their own clock are stamped with it.
   */
  readonly wall: Clock = () => new Date(Date.now() + this.travelledMs)

  /** Notes a jump of time travel, which moved the apps' clocks `ms` ahead of real time. */
  travelled(ms: number): void {
    this.travelledMs += ms
  }

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

  /** Drops every scheduled callback without running it; time stays where it is. */
  cancelAll(): void {
    this.queue = []
  }

  /** Drops every scheduled callback and sets the time to `now`, as a fresh clock would start. */
  restart(now: Date): void {
    this.queue = []
    this.nowMs = now.getTime()
    this.travelledMs = 0
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
