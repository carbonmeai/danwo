/**
 * Recordings on disk, one file per step. A step's key covers what makes it the same step: the
 * project, the journey, the app, the instruction as written, its params (plain values in full;
 * `unique()` values and secrets by kind only), the relocation policy it replays under, and for
 * the second and later step with all of those the same, its occurrence. A
 * recording made in this session is held back until a later check confirms what it did; only then
 * is it written. Each file also keeps the parts of its key, so a step that finds no recording under
 * its own key can still say which recording of the same step it missed, and what changed.
 */
import { createHash, randomBytes } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { z } from "zod"

import { renameOver } from "../support/files.ts"
import { type Params, paramIdentity } from "./params.ts"
import { DEFAULT_RELOCATION, type RelocationPolicy } from "./policy.ts"
import {
  type ExtractTrace,
  extractTraceSchema,
  type StepIdentity,
  type Trace,
  traceSchema,
  storedSchema,
  type WaitTrace,
  waitTraceSchema,
} from "./trace.ts"

/** `off` neither reads nor writes; `read-only` replays but never writes; `read-write` does both. */
export type CacheMode = "off" | "read-only" | "read-write"

/** The version of how keys are made; a new one starts every recording afresh. */
const KEY_FORMAT = 3

export interface ReplayStoreOptions {
  readonly dir: string
  readonly mode: CacheMode
  readonly projectId: string
  readonly journey: string
  readonly appIdentity: string
  /** How replays find recorded elements; part of every key. Default `similar-v1`. */
  readonly policy?: RelocationPolicy
  /**
   * The models the session runs on, by name (`openai/gpt-5-mini`): the actor, and the judge for
   * waits and asserts (the actor when there is none). Each new recording keeps the name of the
   * model that made it; a replay of one another model made says so.
   */
  readonly models?: { readonly actor?: string | undefined; readonly judge?: string | undefined }
}

/** A recording made by another model than the one this session runs on: both names. */
export interface CrossModel {
  readonly recordedWith: string
  readonly runningWith: string
}

/** One agent step as the store keys it: what kind, which one in the journey, and what it said. */
export interface StepCall {
  readonly kind: StepIdentity["kind"]
  /** Zero-based position among the journey's agent steps. */
  readonly step: number
  readonly instruction: string
  readonly params: Params
}

/** A step's key, with the parts it was made from. */
export interface StepKey {
  readonly key: string
  readonly identity: StepIdentity
}

interface Staged {
  readonly key: string
  /** The step that recorded it; a check after it confirms it. */
  readonly step: number
  readonly trace: Trace
}

/** The parts of a key a step can differ in from a recording of the same step. */
const KEY_PARTS = ["instruction", "params", "appIdentity", "policy", "format"] as const

/** Which key parts differ between two identities of the same step. */
function changedParts(now: StepIdentity, recorded: StepIdentity): string[] {
  return KEY_PARTS.filter((part) => JSON.stringify(now[part]) !== JSON.stringify(recorded[part]))
}

export class ReplayStore {
  private readonly options: ReplayStoreOptions
  private staged: Staged[] = []
  /** The positions of the steps keyed so far, by everything else in their keys. */
  private readonly seen = new Map<string, number[]>()

  constructor(options: ReplayStoreOptions) {
    this.options = options
  }

  get reads(): boolean {
    return this.options.mode !== "off"
  }

  get writes(): boolean {
    return this.options.mode === "read-write"
  }

  /**
   * The key of a step: a digest of everything that makes it the same step. The same instruction
   * with the same params twice in a journey is two steps: the second is keyed by its occurrence
   * (1 for the second time, and so on), so each replays its own recording. A step inserted
   * elsewhere in the test changes no key; the first occurrence is keyed as it always was.
   */
  key(call: StepCall): StepKey {
    const { projectId, journey, appIdentity } = this.options
    const base: StepIdentity = {
      format: KEY_FORMAT,
      projectId,
      journey,
      appIdentity,
      kind: call.kind,
      step: call.step,
      instruction: call.instruction,
      params: paramIdentity(call.params),
      policy: this.options.policy ?? DEFAULT_RELOCATION,
    }
    const { step: _position, ...keyed } = base
    const occurrence = this.occurrence(JSON.stringify(keyed), call.step)
    const identity = occurrence === 0 ? base : { ...base, occurrence }
    const digested = occurrence === 0 ? keyed : { ...keyed, occurrence }
    const key = createHash("sha256").update(JSON.stringify(digested)).digest("hex").slice(0, 32)

    return { key, identity }
  }

  /** How many steps before `step` had the same key: 0 for the first. */
  private occurrence(keyed: string, step: number): number {
    const steps = this.seen.get(keyed) ?? []

    if (!steps.includes(step))
      this.seen.set(
        keyed,
        [...steps, step].toSorted((a, b) => a - b),
      )

    return (this.seen.get(keyed) ?? []).indexOf(step)
  }

  /** The recording under `key`, or undefined when there is none or it cannot be read. */
  read(key: string): Promise<Trace | undefined> {
    return this.readAs(key, traceSchema)
  }

  /** The extraction recorded under `key`, or undefined. */
  readExtract(key: string): Promise<ExtractTrace | undefined> {
    return this.readAs(key, extractTraceSchema)
  }

  /** The wait recorded under `key`, or undefined. */
  readWait(key: string): Promise<WaitTrace | undefined> {
    return this.readAs(key, waitTraceSchema)
  }

  /**
   * A recording of the same step (same project, journey, kind and position) kept under another key:
   * which parts of the key changed since. Undefined when there is none.
   */
  async stale(step: StepKey): Promise<readonly string[] | undefined> {
    if (!this.reads) return undefined

    for (const identity of await this.identities()) {
      const sameStep =
        identity.projectId === step.identity.projectId &&
        identity.journey === step.identity.journey &&
        identity.kind === step.identity.kind &&
        identity.step === step.identity.step
      const changed = sameStep ? changedParts(step.identity, identity) : []

      if (changed.length > 0) return changed
    }

    return undefined
  }

  /** The identity of every readable recording in the cache folder. */
  private async identities(): Promise<StepIdentity[]> {
    const names = await readdir(this.options.dir).catch(() => [])
    const found: StepIdentity[] = []

    for (const name of names.filter((file) => file.endsWith(".json"))) {
      const stored = await readStored(join(this.options.dir, name))

      if (stored?.identity !== undefined) found.push(stored.identity)
    }

    return found
  }

  /**
   * Writes an extraction's sources, or what a wait saw, at once: reading the page changes nothing,
   * and the judge already confirmed it, so there is nothing to wait for a check on.
   */
  async writeExtract(step: StepKey, trace: ExtractTrace | WaitTrace): Promise<void> {
    if (!this.writes) return

    await mkdir(this.options.dir, { recursive: true })
    await this.writeFileAtomic(this.file(step.key), {
      ...this.stamped(trace, step.identity.kind),
      identity: step.identity,
    })
  }

  private async readAs<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    if (!this.reads) return undefined

    const raw = await readFile(this.file(key), "utf8").catch(() => undefined)

    if (raw === undefined) return undefined

    try {
      const parsed = schema.safeParse(JSON.parse(raw))

      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  /** The name of the model that runs a step of `kind` in this session. */
  private modelFor(kind: StepIdentity["kind"]): string | undefined {
    const { models } = this.options

    return kind === "wait" || kind === "assert" ? (models?.judge ?? models?.actor) : models?.actor
  }

  /** A recording with the name of the model that made it: as it was, or this session's. */
  private stamped<T extends { readonly recordedBy?: string | undefined }>(
    trace: T,
    kind: StepIdentity["kind"],
  ): T {
    const model = trace.recordedBy ?? this.modelFor(kind)

    return model === undefined ? trace : { ...trace, recordedBy: model }
  }

  /**
   * Both models' names when `trace` was recorded by another model than this session runs `kind`
   * on; empty otherwise, and for a recording that does not say which model made it.
   */
  crossModel(
    trace: { readonly recordedBy?: string | undefined },
    kind: StepIdentity["kind"],
  ): CrossModel | Record<string, never> {
    const running = this.modelFor(kind)
    const recorded = trace.recordedBy

    if (recorded === undefined || running === undefined || recorded === running) return {}

    return { recordedWith: recorded, runningWith: running }
  }

  private async writeFileAtomic(file: string, value: unknown): Promise<void> {
    const partial = `${file}.${randomBytes(4).toString("hex")}.tmp`

    await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`)
    await renameOver(partial, file)
  }

  /** Holds a new recording of step `step` until a check confirms it; replaces an earlier one. */
  stage(key: StepKey, step: number, trace: Trace): void {
    if (!this.writes) return

    const kept = { ...this.stamped(trace, key.identity.kind), identity: key.identity }

    this.staged = [
      ...this.staged.filter((entry) => entry.key !== key.key),
      { key: key.key, step, trace: kept },
    ]
  }

  /** Writes the recordings a later check confirmed and drops the rest. */
  async settle(confirmed: (step: number) => boolean): Promise<void> {
    const keep = this.staged.filter((entry) => confirmed(entry.step))

    this.staged = []
    if (keep.length === 0) return

    await mkdir(this.options.dir, { recursive: true })

    for (const entry of keep) await this.writeFileAtomic(this.file(entry.key), entry.trace)
  }

  private file(key: string): string {
    return join(this.options.dir, `${key}.json`)
  }
}

/** A recording file's common fields, or undefined when it is not one. */
export async function readStored(file: string) {
  const raw = await readFile(file, "utf8").catch(() => undefined)

  if (raw === undefined) return undefined

  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
