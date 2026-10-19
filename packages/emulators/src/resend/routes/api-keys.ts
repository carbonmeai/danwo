import { randomBytes } from "node:crypto"

import type { CreateApiKeyResponseSuccess } from "resend"

import type { ResendRouteContext } from "../context.ts"
import { jsonBody, listOf, newUuid, notFound, resendError, textOf } from "../helpers.ts"

/**
 * API keys: create (the token is shown once), list and remove. A key made with
 * `permission: "sending_access"` may only send; any other `re_` key is accepted with full access.
 */
export function apiKeyRoutes({ app, objects, clock }: ResendRouteContext): void {
  const { keys } = objects

  app.post("/api-keys", async (c) => {
    const body = await jsonBody(c)
    const name = textOf(body.name)

    if (!name) return resendError(c, 422, "missing_required_field", "Missing `name` field.")

    const permission = body.permission === "sending_access" ? "sending_access" : "full_access"
    const token = `re_${randomBytes(18).toString("base64url")}`
    const key = keys.add(
      { id: newUuid(), name, created_at: clock().toISOString(), last_used_at: null },
      { token, permission },
    )

    return c.json({ id: key.id, token } satisfies CreateApiKeyResponseSuccess)
  })

  app.get("/api-keys", (c) => listOf(c, keys.all()))

  app.delete("/api-keys/:id", (c) => {
    const id = c.req.param("id")

    if (!keys.remove(id)) return notFound(c, "API key")

    return c.body(null, 200)
  })
}
