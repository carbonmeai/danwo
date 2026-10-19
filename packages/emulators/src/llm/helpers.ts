/** Hosts, provider detection and each provider's error body. */
import type { Context } from "../http.ts"
import type { LlmProvider } from "./entities.ts"

export const OPENAI_HOST = "api.openai.com"
export const ANTHROPIC_HOST = "api.anthropic.com"
export const GATEWAY_HOST = "ai-gateway.vercel.sh"
export const GOOGLE_AI_HOST = "generativelanguage.googleapis.com"
export const PERPLEXITY_HOST = "api.perplexity.ai"

/** The regions Bedrock's runtime answers in, each on `bedrock-runtime.<region>.amazonaws.com`. */
const BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "us-gov-east-1",
  "us-gov-west-1",
  "ca-central-1",
  "sa-east-1",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "ap-east-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "me-central-1",
]

/** Bedrock's runtime hosts, one per region. */
export const BEDROCK_HOSTS = BEDROCK_REGIONS.map(
  (region) => `bedrock-runtime.${region}.amazonaws.com`,
)

/** The hosts the model API emulator answers. */
export const LLM_HOSTS = [
  OPENAI_HOST,
  ANTHROPIC_HOST,
  GATEWAY_HOST,
  GOOGLE_AI_HOST,
  PERPLEXITY_HOST,
  ...BEDROCK_HOSTS,
]

const BY_HOST: ReadonlyMap<string, LlmProvider> = new Map<string, LlmProvider>([
  [ANTHROPIC_HOST, "anthropic"],
  [GATEWAY_HOST, "gateway"],
  [GOOGLE_AI_HOST, "google"],
  [PERPLEXITY_HOST, "perplexity"],
  ...BEDROCK_HOSTS.map((host): [string, LlmProvider] => [host, "bedrock"]),
])

/** Which provider a host belongs to; any other host is answered as OpenAI. */
export function providerOfHost(host: string): LlmProvider {
  return BY_HOST.get(host) ?? "openai"
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

/** Google's canonical status names, which its error bodies carry beside the HTTP code. */
const GOOGLE_STATUSES: Record<ErrorKind, string> = {
  auth: "PERMISSION_DENIED",
  invalid: "INVALID_ARGUMENT",
  rate_limit: "RESOURCE_EXHAUSTED",
  server: "INTERNAL",
  overloaded: "UNAVAILABLE",
  not_found: "NOT_FOUND",
}

const PERPLEXITY_TYPES: Record<ErrorKind, string> = {
  auth: "invalid_api_key",
  invalid: "invalid_request_error",
  rate_limit: "rate_limit_exceeded",
  server: "api_error",
  overloaded: "api_error",
  not_found: "not_found_error",
}

/** The AWS error names Bedrock sends in `x-amzn-errortype`, which the AWS SDK raises by name. */
const BEDROCK_TYPES: Record<ErrorKind, string> = {
  auth: "AccessDeniedException",
  invalid: "ValidationException",
  rate_limit: "ThrottlingException",
  server: "InternalServerException",
  overloaded: "ServiceUnavailableException",
  not_found: "ResourceNotFoundException",
}

/** The HTTP code each kind answers with when a fault or route names no other. */
const DEFAULT_STATUS: Record<ErrorKind, number> = {
  auth: 401,
  invalid: 400,
  rate_limit: 429,
  server: 500,
  overloaded: 503,
  not_found: 404,
}

/** What shapes an error body: its kind, its message, OpenAI's reason code and the HTTP code. */
interface ErrorParts {
  readonly kind: ErrorKind
  readonly message: string
  readonly code: string | null
  readonly status: number
}

const ERROR_BODIES: Record<LlmProvider, (parts: ErrorParts) => unknown> = {
  openai: ({ kind, message, code }) => ({
    error: { message, type: OPENAI_TYPES[kind], param: null, code },
  }),
  anthropic: ({ kind, message }) => ({
    type: "error",
    error: { type: ANTHROPIC_TYPES[kind], message },
  }),
  gateway: ({ kind, message }) => ({ error: { type: GATEWAY_TYPES[kind], message } }),
  google: ({ kind, message, status }) => ({
    error: { code: status, message, status: GOOGLE_STATUSES[kind] },
  }),
  perplexity: ({ kind, message, status }) => ({
    error: { message, type: PERPLEXITY_TYPES[kind], code: status },
  }),
  bedrock: ({ message }) => ({ message }),
}

/**
 * A provider's error body; `code` is OpenAI's machine-readable reason, when there is one, and
 * `status` the HTTP code it goes out with (Google and Perplexity repeat it in the body).
 */
export function errorBody(
  provider: LlmProvider,
  kind: ErrorKind,
  message: string,
  code: string | null = null,
  status: number = DEFAULT_STATUS[kind],
): unknown {
  return ERROR_BODIES[provider]({ kind, message, code, status })
}

/** Headers an error carries besides its body: Bedrock names the AWS exception in one. */
export function errorHeaders(provider: LlmProvider, kind: ErrorKind): Record<string, string> {
  return provider === "bedrock" ? { "x-amzn-errortype": BEDROCK_TYPES[kind] } : {}
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
  const provider = providerOf(c)
  const kind = kindOfStatus(status)

  return new Response(JSON.stringify(errorBody(provider, kind, message, null, status)), {
    status,
    headers: { "content-type": "application/json", ...errorHeaders(provider, kind) },
  })
}
