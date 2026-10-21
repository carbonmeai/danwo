/** Relay's HTTP API: every route, and one answer for anything that throws. */
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import { ZodError } from "zod"

import { db } from "../shared/db/client.ts"
import { describe } from "../shared/retry.ts"
import { billingApi } from "./billing.ts"
import { integrationsApi } from "./integrations.ts"
import { invitesApi } from "./invites.ts"
import { notesApi } from "./notes.ts"
import { HttpError } from "./problems.ts"
import { realtimeApi } from "./realtime.ts"
import { webhooks } from "./webhooks.ts"
import { workspacesApi } from "./workspaces.ts"

export const app = new Hono()
  .get("/health", async (c) => {
    await db.execute(sql`select 1`)

    return c.json({ ok: true })
  })
  .route("/", webhooks)
  .route("/", workspacesApi)
  .route("/", notesApi)
  .route("/", invitesApi)
  .route("/", billingApi)
  .route("/", integrationsApi)
  .route("/", realtimeApi)

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status)
  if (error instanceof ZodError)
    return c.json({ error: "Check the form and try again.", issues: error.issues }, 400)

  console.error(`${c.req.method} ${c.req.path} failed: ${describe(error)}`)

  return c.json({ error: "Something went wrong. Please try again." }, 500)
})
