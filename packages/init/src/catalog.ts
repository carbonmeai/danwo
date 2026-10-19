/**
 * What `danwo init` offers: the engines tests run on, where agent steps get their model, the
 * providers danwo emulates, and the coding agents it teaches. Each choice carries what the
 * generated files need: package names, environment variable names, the SDK function to call.
 */

/** What tests drive: a browser, an Android device, both, or only the app's HTTP API. */
export const ENGINES = ["web", "mobile", "both", "none"] as const
export type Engine = (typeof ENGINES)[number]

export const ENGINE_LABELS: Readonly<Record<Engine, { label: string; hint: string }>> = {
  web: { label: "Web", hint: "a browser, through Playwright" },
  mobile: { label: "Mobile", hint: "Android, for Expo and React Native apps" },
  both: { label: "Web and mobile", hint: "one config for each" },
  none: { label: "None", hint: "the app's HTTP API only, no browser" },
}

/** A package to add, pinned. */
export interface PackageSpec {
  readonly name: string
  readonly version: string
}

/** Where agent steps get their model. */
export const MODEL_SOURCES = [
  "gateway",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "openai-compatible",
  "none",
] as const
export type ModelSourceId = (typeof MODEL_SOURCES)[number]

export interface ModelSource {
  readonly label: string
  readonly hint: string
  /** The variable that holds the key; none for a local server that takes none. */
  readonly keyEnv?: string
  /** The AI SDK provider package the config imports. */
  readonly package?: PackageSpec
  /** A model to start with; any model the source serves that can call tools works. */
  readonly model?: string
}

const OPENAI_COMPATIBLE: PackageSpec = { name: "@ai-sdk/openai-compatible", version: "3.0.71" }

export const MODEL_SOURCE_INFO: Readonly<Record<ModelSourceId, ModelSource>> = {
  gateway: {
    label: "Vercel AI Gateway",
    hint: "one key for every provider",
    keyEnv: "AI_GATEWAY_API_KEY",
    model: "anthropic/claude-sonnet-5",
  },
  anthropic: {
    label: "Anthropic",
    hint: "Claude, with your Anthropic key",
    keyEnv: "ANTHROPIC_API_KEY",
    package: { name: "@ai-sdk/anthropic", version: "4.0.82" },
    model: "claude-sonnet-5",
  },
  openai: {
    label: "OpenAI",
    hint: "with your OpenAI key",
    keyEnv: "OPENAI_API_KEY",
    package: { name: "@ai-sdk/openai", version: "4.0.96" },
    model: "gpt-5",
  },
  google: {
    label: "Google",
    hint: "Gemini, with your Google AI Studio key",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    package: { name: "@ai-sdk/google", version: "4.0.99" },
    model: "gemini-2.5-pro",
  },
  openrouter: {
    label: "OpenRouter",
    hint: "many providers' models with one key",
    keyEnv: "OPENROUTER_API_KEY",
    package: OPENAI_COMPATIBLE,
    model: "anthropic/claude-sonnet-5",
  },
  "openai-compatible": {
    label: "OpenAI-compatible endpoint",
    hint: "Ollama, LM Studio or a server of your own",
    package: OPENAI_COMPATIBLE,
    model: "qwen3",
  },
  none: { label: "None", hint: "locators only; agent steps need a model" },
}

/** Where an OpenAI-compatible server answers when the user names none: Ollama on this machine. */
export const DEFAULT_COMPATIBLE_URL = "http://localhost:11434/v1"
export const OPENROUTER_URL = "https://openrouter.ai/api/v1"

/** A provider danwo emulates, how a project shows it uses it, and how a config adds it. */
export interface ProviderInfo {
  readonly label: string
  /** Dependency names, or prefixes ending in `/`, that show the app uses it. */
  readonly packages: readonly string[]
  /** Environment variable names that show it. */
  readonly envNames: readonly string[]
  /** The SDK function that adds it to `appEnvironment`'s services. Its fixture is the provider's id. */
  readonly service: string
  /** A test's way to read what reached it, for the example test's comment. */
  readonly read: string
}

export const PROVIDERS = {
  stripe: {
    label: "Stripe",
    packages: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
    envNames: ["STRIPE_SECRET_KEY"],
    service: "stripeService",
    read: "stripe.fetch(request), asked as Stripe's API: GET /v1/checkout/sessions",
  },
  resend: {
    label: "Resend",
    packages: ["resend"],
    envNames: ["RESEND_API_KEY"],
    service: "resendService",
    read: "resendInbox(resend).latest(to)",
  },
  s3: {
    label: "S3 (and Tigris)",
    packages: ["@aws-sdk/client-s3", "@aws-sdk/lib-storage", "@aws-sdk/s3-request-presigner"],
    envNames: ["S3_BUCKET", "AWS_S3_BUCKET", "S3_ENDPOINT"],
    service: "s3Service",
    read: "s3Objects(s3)",
  },
  google: {
    label: "Google",
    packages: ["googleapis", "google-auth-library", "@googleapis/"],
    envNames: ["GOOGLE_CLIENT_ID"],
    service: "googleService",
    read: "gmailMailbox(google, address)",
  },
  microsoft: {
    label: "Microsoft",
    packages: ["@microsoft/microsoft-graph-client", "@azure/msal-node", "@azure/msal-browser"],
    envNames: ["AZURE_AD_CLIENT_ID", "MICROSOFT_CLIENT_ID"],
    service: "microsoftService",
    read: "outlookMailbox(microsoft, address)",
  },
  slack: {
    label: "Slack",
    packages: ["@slack/"],
    envNames: ["SLACK_BOT_TOKEN", "SLACK_CLIENT_ID"],
    service: "slackService",
    read: "slackWorkspace(slack)",
  },
  github: {
    label: "GitHub",
    packages: ["octokit", "@octokit/"],
    envNames: ["GITHUB_APP_ID", "GITHUB_CLIENT_ID"],
    service: "githubService",
    read: 'githubRepo(github, "owner/name")',
  },
  twilio: {
    label: "Twilio",
    packages: ["twilio"],
    envNames: ["TWILIO_ACCOUNT_SID"],
    service: "twilioService",
    read: "twilioInbox(twilio).latest(phone)",
  },
  paystack: {
    label: "Paystack",
    packages: ["paystack", "paystack-api", "@paystack/inline-js", "react-paystack"],
    envNames: ["PAYSTACK_SECRET_KEY"],
    service: "paystackService",
    read: "paystackLedger(paystack)",
  },
  flutterwave: {
    label: "Flutterwave",
    packages: ["flutterwave-node-v3", "flutterwave-react-v3"],
    envNames: ["FLW_SECRET_KEY", "FLUTTERWAVE_SECRET_KEY"],
    service: "flutterwaveService",
    read: "flutterwaveLedger(flutterwave)",
  },
  bachs: {
    label: "Bachs",
    packages: ["@bachs/sdk"],
    envNames: ["BACHS_API_KEY"],
    service: "bachsService",
    read: "bachsLedger(bachs)",
  },
  auth0: {
    label: "Auth0",
    packages: ["auth0", "@auth0/", "express-openid-connect"],
    envNames: ["AUTH0_DOMAIN", "AUTH0_ISSUER_BASE_URL"],
    service: "auth0Service",
    read: "auth0Tenant(auth0)",
  },
  clerk: {
    label: "Clerk",
    packages: ["@clerk/"],
    envNames: ["CLERK_SECRET_KEY"],
    service: "clerkService",
    read: "clerkInstance(clerk)",
  },
  composio: {
    label: "Composio",
    packages: ["@composio/core", "composio-core"],
    envNames: ["COMPOSIO_API_KEY"],
    service: "composioService",
    read: "composioProject(composio)",
  },
  llm: {
    label: "Model APIs (OpenAI, Anthropic, AI Gateway the app calls)",
    packages: ["openai", "@anthropic-ai/sdk", "ai"],
    /* Not by key names: they are also the keys danwo's own agent uses. */
    envNames: [],
    service: "llmService",
    read: "llmCalls(llm)",
  },
} as const satisfies Readonly<Record<string, ProviderInfo>>

export type ProviderId = keyof typeof PROVIDERS
export const PROVIDER_IDS: readonly ProviderId[] = [
  "stripe",
  "resend",
  "s3",
  "google",
  "microsoft",
  "slack",
  "github",
  "twilio",
  "paystack",
  "flutterwave",
  "bachs",
  "auth0",
  "clerk",
  "composio",
  "llm",
]

/** A provider's name for a sentence: its label without the parenthesis. */
export function providerName(id: ProviderId): string {
  return PROVIDERS[id].label.split(" (")[0] ?? id
}

/** The providers' names as a sentence lists them: `Stripe, Resend and S3`. */
export function providerList(ids: readonly ProviderId[]): string {
  const names = ids.map(providerName)

  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`
}

/** Coding agents danwo installs its skill for and registers its MCP server with. */
export const AGENTS = ["claude", "cursor", "codex", "agents"] as const
export type AgentId = (typeof AGENTS)[number]

export interface AgentInfo {
  readonly label: string
  /** Where its copy of the skill goes. */
  readonly skillDir: string
  /** Its MCP client config, when it has one. */
  readonly mcpFile?: string
  /** A folder whose presence shows the project already uses it. */
  readonly marker: string
}

export const AGENT_INFO: Readonly<Record<AgentId, AgentInfo>> = {
  claude: {
    label: "Claude Code",
    skillDir: ".claude/skills/danwo",
    mcpFile: ".mcp.json",
    marker: ".claude",
  },
  cursor: {
    label: "Cursor",
    skillDir: ".agents/skills/danwo",
    mcpFile: ".cursor/mcp.json",
    marker: ".cursor",
  },
  codex: {
    label: "Codex",
    skillDir: ".agents/skills/danwo",
    mcpFile: ".codex/config.toml",
    marker: ".codex",
  },
  agents: {
    label: "Other agents (.agents/skills)",
    skillDir: ".agents/skills/danwo",
    marker: ".agents",
  },
}

/** The packages every danwo project needs. */
export const DANWO_PACKAGES: readonly PackageSpec[] = [
  { name: "@danwo/cli", version: "latest" },
  { name: "@danwo/sdk", version: "latest" },
]

/** The packages a mobile config imports. */
export const MOBILE_PACKAGES: readonly PackageSpec[] = [
  { name: "@danwo/device", version: "latest" },
  { name: "@danwo/expo", version: "latest" },
]

/** Checks whether `value` is one of `choices`. */
export function isOneOf<T extends string>(choices: readonly T[], value: string): value is T {
  return (choices as readonly string[]).includes(value)
}
