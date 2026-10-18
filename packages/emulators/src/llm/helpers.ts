/** Hosts, provider detection and each provider's error body. */
import type { Context } from "../http.ts"
import type { LlmProvider } from "./entities.ts"

export const OPENAI_HOST = "api.openai.com"
export const ANTHROPIC_HOST = "api.anthropic.com"
export const GATEWAY_HOST = "ai-gateway.vercel.sh"

/** The hosts the model API emulator answers. */
export const LLM_HOSTS = [OPENAI_HOST, ANTHROPIC_HOST, GATEWAY_HOST]

/** Which provider a host belongs to. */
export function providerOfHost(host: string): LlmProvider {
  if (host === ANTHROPIC_HOST) return "anthropic"

  return host === GATEWAY_HOST ? "gateway" : "openai"
}

/** The provider a request was made to, by its host. */
export function providerOf(c: Context): LlmProvider {
  return providerOfHost(new URL(c.req.url).hostname)
}

/** A kind of failure, named the way each provider names it. */
export type ErrorKind = "auth" | "invalid" | "rate_limit" | "server" | "overloaded" | "not_found"

const OPENAI_TYPES: Record<ErrorKind, string> = {
  auth: "invalid_request_error",
  invalid: "invalid_request_error",
  rate_limit: "requests",
  server: "server_error",
  overloaded: "server_error",
  not_found: "invalid_request_error",
}

const ANTHROPIC_TYPES: Record<ErrorKind, string> = {
  auth: "authentication_error",
  invalid: "invalid_request_error",
  rate_limit: "rate_limit_error",
  server: "api_error",
  overloaded: "overloaded_error",
  not_found: "not_found_error",
}

const GATEWAY_TYPES: Record<ErrorKind, string> = {
  auth: "authentication_error",
  invalid: "invalid_request_error",
  rate_limit: "rate_limit_exceeded",
  server: "internal_server_error",
  overloaded: "internal_server_error",
  not_found: "not_found",
}

/** A provider's error body; `code` is OpenAI's machine-readable reason, when there is one. */
export function errorBody(
  provider: LlmProvider,
  kind: ErrorKind,
  message: string,
  code: string | null = null,
): unknown {
  if (provider === "anthropic")
    return { type: "error", error: { type: ANTHROPIC_TYPES[kind], message } }
  if (provider === "gateway") return { error: { type: GATEWAY_TYPES[kind], message } }

  return { error: { message, type: OPENAI_TYPES[kind], param: null, code } }
}

/** The kind of failure an HTTP status reads as. */
function kindOfStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return "auth"
  if (status === 404) return "not_found"
  if (status === 429) return "rate_limit"

  return status >= 500 ? "server" : "invalid"
}

/** An error answer in the provider's own shape. */
export function llmError(c: Context, status: number, message: string): Response {
  return c.json(errorBody(providerOf(c), kindOfStatus(status), message), status)
}
