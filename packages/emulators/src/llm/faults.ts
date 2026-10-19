/**
 * Failures a model API call can meet, as the fault matrix injects them: rate limiting with the
 * provider's own headers, the provider failing or overloaded, a prompt over the context window, a
 * slow answer, dropped connections, and answers only the emulator can shape (a refusal, an empty
 * or cut-off answer, a content filter, a malformed tool call, a stream that stops half-way).
 */
import { LLM_BEHAVIOURS } from "./behaviours.ts"
import type { LlmProvider } from "./entities.ts"
import { type ErrorKind, errorBody, errorHeaders, providerOfHost } from "./helpers.ts"

const json = { "content-type": "application/json" }

/** Rate-limit headers beyond `retry-after`, for the providers that send them. */
const RATE_HEADERS: Partial<Record<LlmProvider, () => Record<string, string>>> = {
  anthropic: () => ({
    "anthropic-ratelimit-requests-limit": "50",
    "anthropic-ratelimit-requests-remaining": "0",
    "anthropic-ratelimit-requests-reset": new Date(Date.now() + 1000).toISOString(),
  }),
  openai: () => ({
    "x-ratelimit-limit-requests": "500",
    "x-ratelimit-remaining-requests": "0",
    "x-ratelimit-reset-requests": "1s",
  }),
}

/** The rate-limit headers each provider sends with a 429. */
function rateHeaders(provider: LlmProvider): Record<string, string> {
  return { "retry-after": "1", ...RATE_HEADERS[provider]?.() }
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
    headers: { ...json, ...errorHeaders(provider, kind), ...extra },
    body: JSON.stringify(errorBody(provider, kind, message, reason, code)),
  }
}

const TOO_LONG: Record<LlmProvider, string> = {
  openai:
    "This model's maximum context length is 128000 tokens. However, your messages resulted in 131072 tokens. Please reduce the length of the messages.",
  anthropic: "prompt is too long: 210000 tokens > 200000 maximum",
  gateway: "The prompt is longer than the model's context window.",
  google: "The input token count (1048577) exceeds the maximum number of tokens allowed (1048576).",
  perplexity: "The prompt is longer than the model's context window of 127072 tokens.",
  bedrock: "Input is too long for requested model.",
}

const RATE_LIMITED: Partial<Record<LlmProvider, string>> = {
  google:
    "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
  bedrock: "Too many requests, please wait before trying again.",
}

const OVERLOADED: Partial<Record<LlmProvider, string>> = {
  google: "The model is overloaded. Please try again later.",
  bedrock: "Bedrock is unable to process your request.",
}

/** The provider failing. */
function broken(provider: LlmProvider): LlmFault {
  return status(provider, 500, "server", "The server had an error while processing your request.")
}

/** The provider saying it is overloaded: Anthropic answers 529 for that, the others 503. */
function overloaded(provider: LlmProvider): LlmFault {
  return provider === "anthropic"
    ? status(provider, 529, "overloaded", "Overloaded")
    : status(
        provider,
        503,
        "overloaded",
        OVERLOADED[provider] ?? "The server is overloaded or not ready yet.",
      )
}

function limited(provider: LlmProvider): LlmFault {
  return status(
    provider,
    429,
    "rate_limit",
    RATE_LIMITED[provider] ?? "Rate limit reached for requests",
    rateHeaders(provider),
    "rate_limit_exceeded",
  )
}

/** Routes that generate an answer, where every kind of fault applies. */
const GENERATE = [
  /\/(chat\/completions|responses|messages|language-model|agent|sonar)$/,
  /:(stream)?[Gg]enerateContent$/,
  /\/(converse(-stream)?|invoke(-with-response-stream)?)$/,
]

function generates(path: string): boolean {
  return GENERATE.some((pattern) => pattern.test(path))
}

export function llmOutboundFaults(call: {
  host: string
  method: string
  path: string
}): readonly LlmFault[] {
  const provider = providerOfHost(call.host)
  const path = call.path.split("?")[0] ?? ""

  if (call.method !== "POST" || !generates(path))
    return [limited(provider), broken(provider), { kind: "reset" }]

  return [
    limited(provider),
    broken(provider),
    overloaded(provider),
    status(provider, 400, "invalid", TOO_LONG[provider], {}, "context_length_exceeded"),
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
    ...LLM_BEHAVIOURS.map((behaviour): LlmFault => ({ kind: "emulate", behaviour })),
  ]
}
