/**
 * Recordings on disk, one file per step. A step's key covers what makes it the same step: the
 * project, the journey, the app, the instruction as written and its params (plain values in full;
 * `unique()` values and secrets by kind only). A recording made in this session is held back until
 * a later check confirms what it did; only then is it written.
 */
import { createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { z } from "zod"

import { type Params, paramIdentity } from "./params.ts"
import { type ExtractTrace, extractTraceSchema, type Trace, traceSchema } from "./trace.ts"

/** `off` neither reads nor writes; `read-only` replays but never writes; `read-write` does both. */
export type CacheMode = "off" | "read-only" | "read-write"

export interface ReplayStoreOptions {
  readonly dir: string
  readonly mode: CacheMode
  readonly projectId: string
  readonly journey: string
  readonly appIdentity: string
}

interface Staged {
  readonly key: string
  /** The step that recorded it; a check after it confirms it. */
  readonly step: number
  readonly trace: Trace
}

export class ReplayStore {
  private readonly options: ReplayStoreOptions
  private staged: Staged[] = []

  constructor(options: ReplayStoreOptions) {
    this.options = options
  }

  get reads(): boolean {
    return this.options.mode !== "off"
  }

  get writes(): boolean {
    return this.options.mode === "read-write"
  }

  /** The key of a step: a digest of everything that makes it the same step. */
  key(instruction: string, params: Params): string {
    const { projectId, journey, appIdentity } = this.options
    const identity = JSON.stringify({
      format: 1,
      projectId,
      journey,
      appIdentity,
      instruction,
      params: paramIdentity(params),
    })

    return createHash("sha256").update(identity).digest("hex").slice(0, 32)
  }

  /** The recording under `key`, or undefined when there is none or it cannot be read. */
  read(key: string): Promise<Trace | undefined> {
    return this.readAs(key, traceSchema)
  }

  /** The extraction recorded under `key`, or undefined. */
  readExtract(key: string): Promise<ExtractTrace | undefined> {
    return this.readAs(key, extractTraceSchema)
  }

  /** Writes an extraction's sources at once: a read changes nothing, so needs no confirming. */
  async writeExtract(key: string, trace: ExtractTrace): Promise<void> {
    if (!this.writes) return

    await mkdir(this.options.dir, { recursive: true })
    await this.writeFileAtomic(this.file(key), trace)
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

  private async writeFileAtomic(file: string, value: unknown): Promise<void> {
    const partial = `${file}.${randomBytes(4).toString("hex")}.tmp`

    await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`)
    await rename(partial, file)
  }

  /** Holds a new recording of step `step` until a check confirms it; replaces an earlier one. */
  stage(key: string, step: number, trace: Trace): void {
    if (!this.writes) return
    this.staged = [...this.staged.filter((entry) => entry.key !== key), { key, step, trace }]
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
