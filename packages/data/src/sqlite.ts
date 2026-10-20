/**
 * SQLite snapshots for `danwo matrix`, through SQLite's own online backup: the snapshot is a
 * backup of the app's database file, and a restore backs the snapshot up onto that file. Both
 * go through SQLite's locks, so the app may keep its connection open: its next read sees the
 * restored rows.
 *
 * What it can't do: a restore waits (up to `busyTimeoutMs`) while the app holds a write
 * transaction open, and anything the app keeps in memory outside SQLite (caches, counters) is not
 * restored. Reset those from `onRestore`, e.g. through a test-only reset endpoint.
 */
import { rm } from "node:fs/promises"
import { backup, DatabaseSync } from "node:sqlite"

import type { DatabaseSnapshot } from "./postgres.ts"
import { SnapshotSlots } from "./slots.ts"

/** Which SQLite file `sqliteSnapshot` keeps and brings back, and where it keeps the copy. */
export interface SqliteSnapshotOptions {
  /** The app's database file. */
  readonly file: string
  /** Where the snapshot is kept. Default: `<file>.danwo-snapshot`. */
  readonly snapshotFile?: string
  /** How long a backup waits for the app's write lock before failing. Default: 5000 ms. */
  readonly busyTimeoutMs?: number
  /** Runs after every restore, e.g. to clear what the app caches in memory. */
  readonly onRestore?: () => Promise<void> | void
}

/** Backs `from` up onto `to`, waiting up to `busyTimeoutMs` for locks. */
async function backUp(from: string, to: string, busyTimeoutMs: number): Promise<void> {
  const source = new DatabaseSync(from, { readOnly: true, timeout: busyTimeoutMs })

  try {
    await backup(source, to)
  } finally {
    source.close()
  }
}

/**
 * A snapshot of a SQLite database file for an environment's `snapshot()` and `restore()`.
 *
 * ```ts
 * const db = sqliteSnapshot({ file: "data/app.db" })
 * return { ..., snapshot: (slot) => db.snapshot(slot), restore: (slot) => db.restore(slot), snapshotSlots: true, close: () => db.close() }
 * ```
 */
export function sqliteSnapshot(options: SqliteSnapshotOptions): DatabaseSnapshot {
  const base = options.snapshotFile ?? `${options.file}.danwo-snapshot`
  const wait = options.busyTimeoutMs ?? 5000
  const slots = new SnapshotSlots()
  /** Where slot `n` keeps its copy: slot 0 in the snapshot file itself. */
  const keptIn = (n: number) => (n === 0 ? base : `${base}.${n}`)

  return {
    async snapshot(slot) {
      const kept = keptIn(slots.number(slot))

      await rm(kept, { force: true })
      await backUp(options.file, kept, wait)
    },
    async restore(slot) {
      await backUp(keptIn(slots.kept(slot)), options.file, wait)
      await options.onRestore?.()
    },
    async close() {
      for (const n of slots.all()) await rm(keptIn(n), { force: true })
    },
    snapshotSlots: true,
  }
}

/**
 * A copy of a SQLite database for one worker, e.g. of a seeded database every worker starts from:
 * `await sqliteWorkerFile("seed.db", workerIndex)` resolves to `seed.w0.db`. Made with SQLite's
 * backup, so rows still in the write-ahead log are copied too.
 */
export async function sqliteWorkerFile(file: string, workerIndex: number): Promise<string> {
  const copy = file.replace(/(\.[^./]+)?$/, (ext) => `.w${workerIndex}${ext}`)

  await rm(copy, { force: true })
  await backUp(file, copy, 5000)

  return copy
}
