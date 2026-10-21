/** The API: the digest routes, a health check, and one answer for anything that throws. */
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import { ZodError } from "zod"

import { db, describe } from "../db/client.ts"
import { digestRoutes } from "./digests.ts"

export const app = new Hono()
  .get("/health", async (c) => {
    await db.execute(sql`select 1`)

    return c.json({ ok: true })
  })
  .route("/", digestRoutes)

app.onError((error, c) => {
  if (error instanceof ZodError)
    return c.json(
      { error: error.issues[0]?.message ?? "Invalid request.", issues: error.issues },
      400,
    )

  console.error(`${c.req.method} ${c.req.path} failed: ${describe(error)}`)

  return c.json({ error: "Something went wrong. Please try again." }, 500)
})
