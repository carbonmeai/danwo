/** The shop's HTTP API: every route, and one answer for anything that throws. */
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import { ZodError } from "zod"

import { cart } from "./cart.ts"
import { catalog } from "./catalog.ts"
import { checkout } from "./checkout.ts"
import { db } from "./db/client.ts"
import { ordersApi } from "./orders.ts"
import { describe } from "./retry.ts"
import { webhooks } from "./webhooks.ts"

export const app = new Hono()
  .get("/health", async (c) => {
    await db.execute(sql`select 1`)

    return c.json({ ok: true })
  })
  .route("/", catalog)
  .route("/", cart)
  .route("/", checkout)
  .route("/", ordersApi)
  .route("/", webhooks)

app.onError((error, c) => {
  if (error instanceof ZodError)
    return c.json({ error: "Invalid request.", issues: error.issues }, 400)

  console.error(`${c.req.method} ${c.req.path} failed: ${describe(error)}`)

  return c.json({ error: "Something went wrong. Please try again." }, 500)
})
