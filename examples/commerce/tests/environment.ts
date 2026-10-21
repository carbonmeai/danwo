/**
 * What `danwo.config.ts` needs besides danwo itself: a database of its own for each worker, with
 * the schema pushed and the catalogue seeded, and free ports for the apps.
 */
import { spawnSync } from "node:child_process"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"

import pg from "pg"

import { CATALOG, imageKey } from "../seed/catalog.ts"
import { assertTestDatabase, sqlOn } from "./db.ts"

/** The example's folder, where its scripts and node_modules are. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** The base test database; each worker gets its own beside it. Override with COMMERCE_DATABASE_URL. */
export const BASE_DATABASE_URL =
  process.env.COMMERCE_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/commerce_test"

/** A port nothing listens on yet. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      server.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

/** `commerce_test` as `commerce_w0_test` for worker 0: still a test database by its name. */
function workerDatabaseName(base: string, workerIndex: number): string {
  return base.replace(/_test$/, `_w${workerIndex}_test`)
}

/** Drops and creates `name` on the server of `url`, through its `postgres` database. */
async function recreate(url: string, name: string): Promise<void> {
  const admin = new URL(url)

  admin.pathname = "/postgres"

  const client = new pg.Client({ connectionString: admin.toString() })

  await client.connect()
  try {
    await client.query(`drop database if exists "${name}" with (force)`)
    await client.query(`create database "${name}"`)
  } finally {
    await client.end()
  }
}

/** Creates the shop's tables from its Drizzle schema with `drizzle-kit push`. */
function pushSchema(url: string): void {
  const pushed = spawnSync(`${ROOT}node_modules/.bin/drizzle-kit`, ["push", "--force"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  })

  if (pushed.status !== 0)
    throw new Error(`drizzle-kit push failed:\n${pushed.stdout}\n${pushed.stderr}`)
}

/** Empties the shop's tables and puts the catalogue back, as every run starts. */
export async function seedDatabase(url: string): Promise<void> {
  const sql = sqlOn(url)

  await sql(
    "truncate order_items, orders, checkouts, cart_items, carts, webhook_events, products restart identity cascade",
  )

  for (const product of CATALOG)
    await sql(
      `insert into products (slug, name, category, description, price_cents, stripe_price_id, image_key, stock)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        product.slug,
        product.name,
        product.category,
        product.description,
        product.priceCents,
        product.stripePrice,
        imageKey(product.slug),
        product.stock,
      ],
    )
}

/**
 * A fresh database for one worker, `<base>_w<n>_test`: created, migrated and seeded. Each run
 * starts from it whatever the last run left, and parallel workers never share rows.
 */
export async function workerDatabase(workerIndex: number): Promise<string> {
  assertTestDatabase(BASE_DATABASE_URL)

  const url = new URL(BASE_DATABASE_URL)
  const name = workerDatabaseName(url.pathname.slice(1), workerIndex)

  url.pathname = `/${name}`
  await recreate(BASE_DATABASE_URL, name)
  pushSchema(url.toString())
  await seedDatabase(url.toString())

  return url.toString()
}
