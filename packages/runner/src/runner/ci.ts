/**
 * How a run behaves in CI, and how a suite splits across CI machines. With `CI` set (as every
 * hosted CI sets it), `danwo test` defaults to one retry, a read-only replay cache and no `.only`;
 * each can still be set by the config or a flag.
 */
import { DanwoError } from "../support/codes.ts"

/** Whether the run is in CI: `CI` is set to anything but `false` or `0`. */
export function inCi(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CI?.trim().toLowerCase()

  return value !== undefined && value !== "" && value !== "false" && value !== "0"
}

/** What CI changes about a test run when neither the config nor a flag decides. */
export interface CiDefaults {
  readonly retries: number
  /** Replay from the cache but never write to it, so CI runs leave the cache as committed. */
  readonly cacheReadOnly: boolean
  /** Refuse `.only`, which would quietly skip the rest of the suite. */
  readonly forbidOnly: boolean
}

export function ciDefaults(ci: boolean): CiDefaults {
  return ci
    ? { retries: 1, cacheReadOnly: true, forbidOnly: true }
    : { retries: 0, cacheReadOnly: false, forbidOnly: false }
}

/** A shard of a split run: the `index`th (from 1) of `total`. */
export interface Shard {
  readonly index: number
  readonly total: number
}

/** Reads `i/n`, e.g. `2/4`. */
export function parseShard(value: string): Shard {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim())
  const index = Number(match?.[1])
  const total = Number(match?.[2])

  if (match === null || total < 1 || index < 1 || index > total) {
    throw new DanwoError(
      "CONFIG_INVALID",
      `--shard takes i/n with 1 <= i <= n, e.g. 2/4 (got "${value}")`,
    )
  }

  return { index, total }
}

/**
 * The files shard `shard` runs: sorted by path, every `total`th one starting at `index`. Every
 * machine computes the same split from the same files, so the shards cover the suite once.
 */
export function shardFiles(files: readonly string[], shard: Shard): string[] {
  return files.toSorted().filter((_, position) => position % shard.total === shard.index - 1)
}

export function shardLabel(shard: Shard): string {
  return `${shard.index}/${shard.total}`
}
