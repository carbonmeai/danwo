import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { sqliteSnapshot, sqliteWorkerFile } from "../src/sqlite.ts"

const Count = z.object({ count: z.number() })

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-sqlite-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Opens the "app's" connection: write-ahead logging and an orders table. */
function openApp(file: string): DatabaseSync {
  const app = new DatabaseSync(file)

  app.exec("PRAGMA journal_mode = WAL")
  app.exec("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, item TEXT NOT NULL)")

  return app
}

function countOrders(db: DatabaseSync): number {
  return Count.parse(db.prepare("SELECT count(*) AS count FROM orders").get()).count
}

describe("sqliteSnapshot", () => {
  it("restores the snapshot while the app keeps its connection open", async () => {
    const file = join(dir, "app.db")
    const app = openApp(file)

    app.exec("INSERT INTO orders (item) VALUES ('seed')")

    const db = sqliteSnapshot({ file })

    try {
      await db.snapshot()
      app.exec("INSERT INTO orders (item) VALUES ('trial one'), ('trial two')")
      expect(countOrders(app)).toBe(3)

      await db.restore()
      expect(countOrders(app)).toBe(1)

      // The app writes again after a restore, and the next restore undoes that too.
      app.exec("INSERT INTO orders (item) VALUES ('trial three')")
      await db.restore()
      expect(countOrders(app)).toBe(1)
    } finally {
      app.close()
      await db.close()
    }
  })

  it("runs the restore hook after every restore", async () => {
    const file = join(dir, "app.db")
    const app = openApp(file)
    let restored = 0
    const db = sqliteSnapshot({
      file,
      onRestore: () => {
        restored += 1
      },
    })

    try {
      await db.snapshot()
      await db.restore()
      await db.restore()
      expect(restored).toBe(2)
    } finally {
      app.close()
      await db.close()
    }
  })

  it("gives each worker its own copy of a seeded file, rows in the log included", async () => {
    const file = join(dir, "seed.db")
    const seed = openApp(file)

    seed.exec("INSERT INTO orders (item) VALUES ('a'), ('b')")

    const copies = await Promise.all([0, 1].map((index) => sqliteWorkerFile(file, index)))

    seed.close()
    expect(copies).toEqual([join(dir, "seed.w0.db"), join(dir, "seed.w1.db")])

    const first = new DatabaseSync(copies[0] ?? "")
    const second = new DatabaseSync(copies[1] ?? "")

    first.exec("INSERT INTO orders (item) VALUES ('only in w0')")
    expect([countOrders(first), countOrders(second)]).toEqual([3, 2])
    first.close()
    second.close()
  })
})
