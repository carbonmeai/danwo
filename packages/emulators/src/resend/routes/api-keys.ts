import { randomBytes } from "node:crypto"

import type { CreateApiKeyResponseSuccess } from "resend"

import type { ResendRouteContext } from "../context.ts"
import { jsonBody, listOf, newUuid, notFound, resendError, textOf } from "../helpers.ts"

/** API keys: create (the token is shown once), list and remove. Any `re_` key is accepted anyway. */
export function apiKeyRoutes({ app, objects, clock }: ResendRouteContext): void {
  const { keys } = objects

  app.post("/api-keys", async (c) => {
    const name = textOf((await jsonBody(c)).name)

    if (!name) return resendError(c, 422, "missing_required_field", "Missing `name` field.")

    const token = `re_${randomBytes(18).toString("base64url")}`
    const key = keys.add(
      { id: newUuid(), name, created_at: clock().toISOString(), last_used_at: null },
      { token },
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
