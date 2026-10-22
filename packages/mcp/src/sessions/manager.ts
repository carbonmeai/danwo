/**
 * The server's side of live sessions: each one is a process of its own (see `child.ts`) with its
 * own environment and browser (or the environment's device), numbered `s1`, `s2`… A session closes when the agent closes it,
 * when it has had no calls for a while, or when the client goes away. Only so many may be open at
 * once; each takes a slot, which its environment gets as its worker index.
 */
import type { ChildProcess } from "node:child_process"

import type { JobPlace } from "../jobs/protocol.ts"
import { forkInProject, stderrTail, stopGroup } from "../jobs/run.ts"
import {
  isSessionMessage,
  type OpenRequest,
  type SessionAnswer,
  type SessionCall,
} from "./protocol.ts"

const SESSION_ENTRY = new URL("./child.ts", import.meta.url)
const CLOSE_WAIT_MS = 15_000

export interface SessionLimits {
  /** How many sessions may be open at once. Default 4. */
  readonly max?: number
  /** A session with no calls for this long closes. Default 10 minutes. */
  readonly idleMs?: number
}

/** How a session opens. */
interface OpenOptions {
  /** Drives the environment's device instead of a browser. */
  readonly device?: boolean | undefined
  readonly signal?: AbortSignal | undefined
}

interface Pending {
  readonly resolve: (answer: SessionAnswer) => void
  readonly reject: (error: Error) => void
}

class LiveSession {
  readonly id: string
  readonly slot: number
  private readonly child: ChildProcess
  private readonly pending = new Map<number, Pending>()
  private seq = 0
  private exited: string | undefined

  constructor(id: string, slot: number, child: ChildProcess) {
    this.id = id
    this.slot = slot
    this.child = child

    const stderr = stderrTail(child)

    child.on("message", (message: unknown) => this.receive(message))
    child.once("exit", (code, signal) => {
      const tail = stderr()

      this.exited = `its process exited with ${signal ?? `code ${code}`}${tail === "" ? "" : `:\n${tail}`}`
      for (const waiting of this.pending.values())
        waiting.reject(new Error(`session ${id}: ${this.exited}`))
      this.pending.clear()
    })
  }

  /** Waits for the process to open the session, or to fail doing it. */
  opened(signal: AbortSignal | undefined): Promise<SessionAnswer> {
    const { promise, resolve, reject } = Promise.withResolvers<SessionAnswer>()

    const cancel = () => {
      stopGroup(this.child)
      reject(new Error("cancelled"))
    }

    signal?.addEventListener("abort", cancel, { once: true })
    this.child.on("message", (message: unknown) => {
      if (!isSessionMessage(message)) return
      if (message.type === "opened") resolve(message.answer)
      if (message.type === "failed") reject(new Error(message.message))
    })
    this.child.once("exit", () =>
      reject(new Error(`session ${this.id}: ${this.exited ?? "exited"}`)),
    )

    return promise.finally(() => signal?.removeEventListener("abort", cancel))
  }

  /** Hands the process what to open. */
  start(request: OpenRequest): void {
    this.child.send(request)
  }

  call(call: SessionCall): Promise<SessionAnswer> {
    if (this.exited !== undefined)
      return Promise.reject(new Error(`session ${this.id}: ${this.exited}`))

    const seq = ++this.seq
    const { promise, resolve, reject } = Promise.withResolvers<SessionAnswer>()

    this.pending.set(seq, { resolve, reject })
    this.child.send({ type: "call", seq, call })

    return promise
  }

  /** Asks the process to close everything it started; stops its group if it does not in time. */
  async close(): Promise<void> {
    /* A process that already ended may have left its app or browser behind in its group. */
    if (this.exited !== undefined) {
      stopGroup(this.child)

      return
    }

    const done = new Promise<void>((resolve) => this.child.once("exit", () => resolve()))
    const timer = setTimeout(() => stopGroup(this.child), CLOSE_WAIT_MS)

    await this.call({ kind: "close" }).catch(() => undefined)
    await done
    clearTimeout(timer)
  }

  private receive(message: unknown): void {
    if (!isSessionMessage(message) || (message.type !== "answer" && message.type !== "error"))
      return

    const waiting = this.pending.get(message.seq)

    this.pending.delete(message.seq)
    if (message.type === "answer") waiting?.resolve(message.answer)
    else waiting?.reject(new Error(message.message))
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  /** Why a session that is gone went, for an agent still calling it. */
  private readonly gone = new Map<string, string>()
  private readonly place: JobPlace
  private readonly max: number
  private readonly idleMs: number
  private next = 1

  constructor(place: JobPlace, limits: SessionLimits = {}) {
    this.place = place
    this.max = limits.max ?? 4
    this.idleMs = limits.idleMs ?? 600_000
  }

  /**
   * Opens a session on `path`, in a browser or (with `device`) on the environment's device;
   * answers with its id and first snapshot.
   */
  async open(path: string, options: OpenOptions = {}): Promise<SessionAnswer> {
    const slot = this.freeSlot()
    const id = `s${this.next++}`
    const session = new LiveSession(id, slot, forkInProject(SESSION_ENTRY, this.place))

    this.sessions.set(id, session)

    const opened = session.opened(options.signal)
    const device = options.device ?? false

    try {
      session.start({ type: "open", place: this.place, slot, id, path, device })

      const answer = await opened

      this.touch(id)

      return answer
    } catch (error) {
      this.sessions.delete(id)
      await session.close()
      throw error
    }
  }

  async call(id: string, call: SessionCall): Promise<SessionAnswer> {
    const session = this.find(id)

    this.touch(id)

    try {
      return await session.call(call)
    } finally {
      this.touch(id)
    }
  }

  async close(id: string, reason = "it was closed"): Promise<void> {
    const session = this.find(id)

    this.forget(id, reason)
    await session.close()
  }

  async closeAll(): Promise<void> {
    const open = [...this.sessions.keys()]

    await Promise.all(open.map((id) => this.close(id, "the server shut down")))
  }

  private freeSlot(): number {
    const taken = new Set([...this.sessions.values()].map((session) => session.slot))

    for (let slot = 0; slot < this.max; slot++) if (!taken.has(slot)) return slot

    throw new Error(
      `${this.max} sessions are open, the limit: close one with close_session before opening another`,
    )
  }

  private find(id: string): LiveSession {
    const session = this.sessions.get(id)

    if (session !== undefined) return session

    const why = this.gone.get(id)

    throw new Error(
      why === undefined
        ? `no session "${id}": open one with open_session`
        : `session ${id} is closed (${why}): open a new one with open_session`,
    )
  }

  private forget(id: string, reason: string): void {
    this.sessions.delete(id)
    this.gone.set(id, reason)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
  }

  /** Restarts the session's idle clock. */
  private touch(id: string): void {
    clearTimeout(this.timers.get(id))

    const minutes = Math.round(this.idleMs / 60_000)
    const timer = setTimeout(() => {
      void this.close(
        id,
        `no calls for ${minutes > 0 ? `${minutes} min` : `${this.idleMs} ms`}`,
      ).catch(() => undefined)
    }, this.idleMs)

    timer.unref()
    this.timers.set(id, timer)
  }
}
