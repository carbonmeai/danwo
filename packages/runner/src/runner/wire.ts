/**
 * Calls across the IPC channel between a run and one of its worker processes. The run calls a
 * worker method by name and awaits its answer; the worker can also send notes while it works.
 * Every message is tagged, so anything else on the channel is ignored rather than misread.
 */
import type { ChildProcess } from "node:child_process"

import type { WorkerCalls, WorkerNote } from "./tasks.ts"

const TAG = "danwo/1"

type Method = keyof WorkerCalls
type Argument<M extends Method> = Parameters<WorkerCalls[M]>
type Answer<M extends Method> = Awaited<ReturnType<WorkerCalls[M]>>

type Message =
  | {
      readonly tag: typeof TAG
      readonly call: number
      readonly method: Method
      readonly args: unknown[]
    }
  | { readonly tag: typeof TAG; readonly answers: number; readonly value: unknown }
  | { readonly tag: typeof TAG; readonly answers: number; readonly failure: string }
  | ({ readonly tag: typeof TAG } & WorkerNote)

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && "tag" in value && value.tag === TAG
}

/** An error's stack (or message) as text: what a failed call carries back. */
function describeFailure(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

interface Waiting {
  resolve(value: unknown): void
  reject(error: Error): void
}

/** The run's end of one worker's channel. */
export interface WorkerLink {
  /** Whether the process is still there to take calls. */
  alive(): boolean
  /** Calls `method` in the worker; rejects if it throws there or the process goes away first. */
  call<M extends Method>(method: M, ...args: Argument<M>): Promise<Answer<M>>
  /** Waits for the process to end, killing it if it has not ended by itself within `ms`. */
  ended(ms: number): Promise<void>
}

/** Links to `child`; its notes go to `onNote`. */
export function linkWorker(child: ChildProcess, onNote: (note: WorkerNote) => void): WorkerLink {
  const waiting = new Map<number, Waiting>()
  let lastCall = 0
  let gone: string | undefined

  child.on("message", (message: unknown) => {
    if (!isMessage(message)) return
    if ("topic" in message) onNote(message)
    if (!("answers" in message)) return

    const caller = waiting.get(message.answers)

    waiting.delete(message.answers)
    if ("failure" in message) caller?.reject(new Error(message.failure))
    else caller?.resolve(message.value)
  })
  child.on("exit", (code, signal) => {
    gone = `exited with ${signal ?? `code ${code}`}`
    for (const caller of waiting.values()) caller.reject(new Error(`worker ${gone}`))
    waiting.clear()
  })

  return {
    alive: () => gone === undefined,
    call(method, ...args) {
      if (gone !== undefined) return Promise.reject(new Error(`worker ${gone}`))

      const call = ++lastCall

      return new Promise((resolve, reject) => {
        waiting.set(call, { resolve: (value) => resolve(value as never), reject })
        child.send({ tag: TAG, call, method, args } satisfies Message)
      })
    },
    async ended(ms) {
      if (gone !== undefined) return

      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
      const timer = setTimeout(() => child.kill("SIGKILL"), ms)

      await exited
      clearTimeout(timer)
    },
  }
}

/** The worker's end: answers the run's calls with `methods`, one at a time, in arrival order. */
export function answerCalls(methods: WorkerCalls): void {
  let previous: Promise<void> = Promise.resolve()

  process.on("message", (message: unknown) => {
    if (!isMessage(message) || !("method" in message)) return

    previous = previous.then(() => answer(methods, message))
  })
}

async function answer(
  methods: WorkerCalls,
  message: Extract<Message, { method: Method }>,
): Promise<void> {
  const run = methods[message.method] as (...args: unknown[]) => Promise<unknown>

  try {
    const value = await run.apply(methods, message.args)

    process.send?.({ tag: TAG, answers: message.call, value } satisfies Message)
  } catch (error) {
    process.send?.({
      tag: TAG,
      answers: message.call,
      failure: describeFailure(error),
    } satisfies Message)
  }
}

/** Sends the run a note from inside a worker. */
export function sendNote(note: WorkerNote): void {
  process.send?.({ tag: TAG, ...note } satisfies Message)
}
