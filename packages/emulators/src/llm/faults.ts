/**
 * Failures a model API call can meet, as the fault matrix injects them: rate limiting with the
 * provider's own headers, the provider failing or overloaded, a prompt over the context window, a
 * slow answer, dropped connections, and answers only the emulator can shape (a refusal, an empty
 * or cut-off answer, a content filter, a malformed tool call, a stream that stops half-way).
 */
import { LLM_BEHAVIOURS } from "./behaviours.ts"
import type { LlmProvider } from "./entities.ts"
import { type ErrorKind, errorBody, providerOfHost } from "./helpers.ts"

const json = { "content-type": "application/json" }

/** The rate-limit headers each provider sends with a 429. */
function rateHeaders(provider: LlmProvider): Record<string, string> {
  if (provider === "anthropic")
    return {
      "retry-after": "1",
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-requests-remaining": "0",
      "anthropic-ratelimit-requests-reset": new Date(Date.now() + 1000).toISOString(),
    }
  if (provider === "gateway") return { "retry-after": "1" }

  return {
    "retry-after": "1",
    "x-ratelimit-limit-requests": "500",
    "x-ratelimit-remaining-requests": "0",
    "x-ratelimit-reset-requests": "1s",
  }
}

/** A fault as the proxy applies it. */
type LlmFault =
  | {
      readonly kind: "status"
      readonly status: number
      readonly headers: Readonly<Record<string, string>>
      readonly body: string
    }
  | { readonly kind: "reset" | "reset-after" }
  | { readonly kind: "delay"; readonly ms: number }
  | { readonly kind: "emulate"; readonly behaviour: string }

function status(
  provider: LlmProvider,
  code: number,
  kind: ErrorKind,
  message: string,
  extra: Record<string, string> = {},
  reason: string | null = null,
): LlmFault {
  return {
    kind: "status",
    status: code,
    headers: { ...json, ...extra },
    body: JSON.stringify(errorBody(provider, kind, message, reason)),
  }
}

const TOO_LONG: Record<LlmProvider, string> = {
  openai:
    "This model's maximum context length is 128000 tokens. However, your messages resulted in 131072 tokens. Please reduce the length of the messages.",
  anthropic: "prompt is too long: 210000 tokens > 200000 maximum",
  gateway: "The prompt is longer than the model's context window.",
}

/** The provider failing. */
function broken(provider: LlmProvider): LlmFault {
  return status(provider, 500, "server", "The server had an error while processing your request.")
}

/** The provider saying it is overloaded: Anthropic answers 529 for that, the others 503. */
function overloaded(provider: LlmProvider): LlmFault {
  return provider === "anthropic"
    ? status(provider, 529, "overloaded", "Overloaded")
    : status(provider, 503, "overloaded", "The server is overloaded or not ready yet.")
}

/** Routes that generate an answer, where every kind of fault applies. */
const GENERATE = /\/(chat\/completions|responses|messages|language-model)$/

export function llmOutboundFaults(call: {
  host: string
  method: string
  path: string
}): readonly LlmFault[] {
  const provider = providerOfHost(call.host)
  const limited = status(
    provider,
    429,
    "rate_limit",
    "Rate limit reached for requests",
    rateHeaders(provider),
    "rate_limit_exceeded",
  )
  const path = call.path.split("?")[0] ?? ""

  if (call.method !== "POST" || !GENERATE.test(path))
    return [limited, broken(provider), { kind: "reset" }]

  return [
    limited,
    broken(provider),
    overloaded(provider),
    status(provider, 400, "invalid", TOO_LONG[provider], {}, "context_length_exceeded"),
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
    ...LLM_BEHAVIOURS.map((behaviour): LlmFault => ({ kind: "emulate", behaviour })),
  ]
}
