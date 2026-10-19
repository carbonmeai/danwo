import type { Context, Middleware } from "../http.ts"
import type { LlmProvider } from "./entities.ts"
import { llmError, providerOf } from "./helpers.ts"

/** What each provider answers when a call carries no key, and with which HTTP code. */
const MISSING: Record<LlmProvider, { readonly status: number; readonly message: string }> = {
  openai: {
    status: 401,
    message:
      "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY).",
  },
  anthropic: { status: 401, message: "x-api-key header is required" },
  gateway: { status: 401, message: "Unauthenticated request to AI Gateway." },
  google: {
    status: 403,
    message:
      "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
  },
  perplexity: { status: 401, message: "Missing API key. Provide it as a Bearer token." },
  bedrock: { status: 403, message: "Missing Authentication Token" },
}

/** A SigV4 `Authorization` header: algorithm, credential scope, signed headers and signature. */
const SIGV4 =
  /^AWS4-HMAC-SHA256 Credential=[^/\s,]+\/\d{8}\/[a-z0-9-]+\/bedrock\/aws4_request,\s*SignedHeaders=[a-z0-9;-]+,\s*Signature=[0-9a-f]{64}$/

function header(c: Context, name: string): string {
  return c.req.header(name) ?? ""
}

function hasBearer(c: Context): boolean {
  return /^Bearer\s+\S+/i.test(header(c, "authorization"))
}

/**
 * How each provider takes its key (any key works): a bearer token for OpenAI, Perplexity and the
 * gateway; `x-api-key` or a bearer token for Anthropic; `x-goog-api-key` or `?key=` for Gemini;
 * a well-formed SigV4 signature or a Bedrock API key (a bearer token) for Bedrock.
 */
const KEYED: Record<LlmProvider, (c: Context) => boolean> = {
  openai: hasBearer,
  gateway: hasBearer,
  perplexity: hasBearer,
  anthropic: (c) => hasBearer(c) || header(c, "x-api-key") !== "",
  google: (c) => header(c, "x-goog-api-key") !== "" || new URL(c.req.url).searchParams.has("key"),
  bedrock: (c) => hasBearer(c) || SIGV4.test(header(c, "authorization")),
}

/** Every call must carry a key the way its provider expects. */
export const llmAuth: Middleware = (c, next) => {
  const provider = providerOf(c)
  const missing = MISSING[provider]

  return KEYED[provider](c) ? next() : llmError(c, missing.status, missing.message)
}
