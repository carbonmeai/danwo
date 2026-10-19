/**
 * The worker processes of one run. Each worker owns one environment (the app, its emulators and
 * the proxy), which a task resets and arms with faults, so a worker takes one task at a time and
 * the crew hands every task to whichever worker is free. Workers start on their first task. One
 * that dies fails the task it held and is started again before its next.
 */
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"

import { type OwnedChild, own } from "../support/children.ts"
import type { WorkerLiveEvent } from "./live.ts"
import type { TestFileTask, TestReport, TrialReport, TrialTask, WorkerStart } from "./tasks.ts"
import { linkWorker, type WorkerLink } from "./wire.ts"

const WORKER_ENTRY = fileURLToPath(new URL("./worker.ts", import.meta.url))
const TYPESCRIPT_HOOK = new URL("./register.ts", import.meta.url).href
/** Strips types under `node_modules`, where Node will not; first, so the hooks after it load. */
const INSTALLED_HOOK = new URL("../../strip-types.mjs", import.meta.url).href

/** How long a worker gets to dispose its environment before it is killed. */
const STOP_GRACE_MS = 10_000

export interface CrewOptions {
  readonly size: number
  /** Everything a worker's `start` gets except its index. */
  readonly start: Omit<WorkerStart, "workerIndex">
  /** A test finished somewhere in the crew. */
  readonly onTested?: (report: TestReport) => void
  /** Something happened inside an attempt, for the run's live feed. */
  readonly onLive?: (event: WorkerLiveEvent) => void
}

interface Member {
  readonly index: number
  link: WorkerLink | undefined
  /** The worker's process group: it and whatever it started that has no group of its own. */
  process: OwnedChild | undefined
  /** Settles once `start` answered; rejects with why the worker could not start. */
  started: Promise<void> | undefined
}

export class Crew {
  private readonly options: CrewOptions
  private readonly members: readonly Member[]
  private readonly idle: Member[]
  private readonly queue: ((member: Member) => void)[] = []

  constructor(options: CrewOptions) {
    this.options = options
    this.members = Array.from({ length: Math.max(1, options.size) }, (_, index) => ({
      index,
      link: undefined,
      process: undefined,
      started: undefined,
    }))
    this.idle = [...this.members]
  }

  /** How many workers the crew has: how many tasks run at once. */
  get size(): number {
    return this.members.length
  }

  /** Runs a test file on the next free worker. */
  testFile(task: TestFileTask): Promise<readonly TestReport[]> {
    return this.withMember((link) => link.call("testFile", task))
  }

  /** Runs a trial on the next free worker. */
  trial(task: TrialTask): Promise<TrialReport> {
    return this.withMember((link) => link.call("trial", task))
  }

  /** Stops every worker that started, letting each close its environment first. */
  async disband(): Promise<void> {
    await Promise.all(
      this.members.map(async ({ link, process: worker }) => {
        if (link?.alive() === true) {
          void link.call("stop").catch(() => undefined)
          await link.ended(STOP_GRACE_MS)
        }

        /* A worker that exited can leave children in its group, such as an app it never stopped. */
        await worker?.stop(1_000)
      }),
    )
  }

  private async withMember<T>(work: (link: WorkerLink) => Promise<T>): Promise<T> {
    const member = await this.claim()

    try {
      return await work(await this.ready(member))
    } finally {
      this.release(member)
    }
  }

  private claim(): Promise<Member> {
    const member = this.idle.shift()

    if (member !== undefined) return Promise.resolve(member)

    return new Promise((resolve) => this.queue.push(resolve))
  }

  private release(member: Member): void {
    const next = this.queue.shift()

    if (next === undefined) this.idle.push(member)
    else next(member)
  }

  /** The member's worker, started (again) when it has none or the last one died. */
  private async ready(member: Member): Promise<WorkerLink> {
    if (member.link === undefined || !member.link.alive()) {
      const { link, process: worker } = this.spawn()

      void member.process?.stop(1_000)
      member.link = link
      member.process = worker
      member.started = link
        .call("start", { ...this.options.start, workerIndex: member.index })
        .catch((error: unknown) => {
          const why = error instanceof Error ? error.message : String(error)

          throw new Error(`worker ${member.index} failed to start: ${why}`)
        })
    }

    await member.started

    return member.link
  }

  private spawn(): { readonly link: WorkerLink; readonly process: OwnedChild } {
    const child = fork(WORKER_ENTRY, [], {
      execArgv: ["--import", INSTALLED_HOOK, "--import", TYPESCRIPT_HOOK],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: process.env,
      detached: process.platform !== "win32",
    })
    const link = linkWorker(child, (note) => {
      if (note.topic === "tested") this.options.onTested?.(note.data)
      else this.options.onLive?.(note.data)
    })

    return { link, process: own(child) }
  }
}
