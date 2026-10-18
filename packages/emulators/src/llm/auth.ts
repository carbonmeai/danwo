import type { Middleware } from "../http.ts"
import { llmError, providerOf } from "./helpers.ts"

const MISSING = {
  openai:
    "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY).",
  anthropic: "x-api-key header is required",
  gateway: "Unauthenticated request to AI Gateway.",
}

/**
 * Every call must carry a key the way its provider expects (any key works): `Authorization:
 * Bearer` for OpenAI and the gateway, `x-api-key` or a bearer token for Anthropic.
 */
export const llmAuth: Middleware = (c, next) => {
  const provider = providerOf(c)
  const bearer = /^Bearer\s+\S+/i.test(c.req.header("authorization") ?? "")
  const keyed = bearer || (provider === "anthropic" && (c.req.header("x-api-key") ?? "") !== "")

  return keyed ? next() : llmError(c, 401, MISSING[provider])
}
