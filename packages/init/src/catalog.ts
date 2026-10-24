/**
 * What `danwo init` offers: the engines tests run on, where agent steps get their model, the
 * providers danwo emulates, and the coding agents it teaches. Each choice carries what the
 * generated files need: package names, environment variable names, the SDK function to call.
 */
import { readFileSync } from "node:fs"

/** What tests drive: a browser, an Android device, both, or only the app's HTTP API. */
export const ENGINES = ["web", "mobile", "both", "none"] as const
export type Engine = (typeof ENGINES)[number]

export const ENGINE_LABELS: Readonly<Record<Engine, { label: string; hint: string }>> = {
  web: { label: "Web", hint: "a browser, through Playwright" },
  mobile: { label: "Mobile", hint: "Android and iOS: Expo, React Native, native or Flutter" },
  both: { label: "Web and mobile", hint: "one config for each" },
  none: { label: "None", hint: "the app's HTTP API only, no browser" },
}

/** The browsers web tests can run in; Chromium alone unless the project asks for more. */
export const BROWSERS = ["chromium", "firefox", "webkit"] as const
export type Browser = (typeof BROWSERS)[number]

export const BROWSER_LABELS: Readonly<Record<Browser, { label: string; hint: string }>> = {
  chromium: { label: "Chromium", hint: "Chrome and Edge's engine; the default" },
  firefox: { label: "Firefox", hint: "Gecko" },
  webkit: { label: "WebKit", hint: "Safari's engine" },
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
  "codex-cli",
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
  /** A coding CLI the source runs on, signed in to a plan, in place of a key. */
  readonly cli?: { readonly sdk: string; readonly title: string; readonly login: string }
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
  "codex-cli": {
    label: "Codex CLI",
    hint: "your ChatGPT plan, through the Codex CLI; no API key",
    cli: { sdk: "codexCli", title: "the Codex CLI", login: "codex login" },
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
  nylas: {
    label: "Nylas",
    packages: ["nylas", "@nylas/"],
    envNames: ["NYLAS_API_KEY", "NYLAS_CLIENT_ID"],
    service: "nylasService",
    read: "nylasApplication(nylas)",
  },
  nango: {
    label: "Nango",
    packages: ["@nangohq/"],
    envNames: ["NANGO_SECRET_KEY"],
    service: "nangoService",
    read: "nangoProject(nango)",
  },
  unipile: {
    label: "Unipile",
    packages: ["unipile-node-sdk"],
    envNames: ["UNIPILE_ACCESS_TOKEN", "UNIPILE_DSN"],
    service: "unipileService",
    read: "unipileWorkspace(unipile)",
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
  "nylas",
  "nango",
  "unipile",
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
export const AGENTS = ["claude", "cursor", "codex", "copilot", "agents"] as const
export type AgentId = (typeof AGENTS)[number]

export interface AgentInfo {
  readonly label: string
  /** Where its copy of the skill goes. */
  readonly skillDir: string
  /** Its MCP client config, when it has one. */
  readonly mcpFile?: string
  /** A folder or file whose presence shows the project already uses it. */
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
  copilot: {
    label: "GitHub Copilot (VS Code)",
    skillDir: ".agents/skills/danwo",
    mcpFile: ".vscode/mcp.json",
    /* A `.vscode` folder alone is common; VS Code's MCP file shows Copilot's agent mode is in use. */
    marker: ".vscode/mcp.json",
  },
  agents: {
    label: "Other agents (.agents/skills)",
    skillDir: ".agents/skills/danwo",
    marker: ".agents",
  },
}

/** This package's version from its package.json; danwo's packages are released together. */
function ownVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  )
  const version: unknown = Reflect.get(Object(manifest), "version")

  return typeof version === "string" ? version : "0.0.0"
}

/** The running danwo's version; `0.0.0` in danwo's own repository. */
export const DANWO_VERSION = ownVersion()

/**
 * The version danwo's packages are added at: the running danwo's, so a project set up by a beta
 * gets that beta rather than whatever `latest` is. From the repository, `latest`.
 */
const ADDED_VERSION = DANWO_VERSION === "0.0.0" ? "latest" : DANWO_VERSION

/** The packages every danwo project needs. */
export const DANWO_PACKAGES: readonly PackageSpec[] = [
  { name: "@danwo/cli", version: ADDED_VERSION },
  { name: "@danwo/sdk", version: ADDED_VERSION },
]

/** The packages a mobile config imports: the device driver, which `@danwo/cli` leaves out. */
export const MOBILE_PACKAGES: readonly PackageSpec[] = [
  { name: "@danwo/mobile", version: ADDED_VERSION },
]

/**
 * The packages coding agents use, which `@danwo/cli` leaves out: the MCP server their config
 * starts, and the recorder its recording tools and `danwo record` run.
 */
export const AGENT_PACKAGES: readonly PackageSpec[] = [
  { name: "@danwo/mcp", version: ADDED_VERSION },
  { name: "@danwo/recorder", version: ADDED_VERSION },
]

/** Node's types: danwo's declarations use them, so a TypeScript project needs them to type-check. */
export const NODE_TYPES: PackageSpec = { name: "@types/node", version: "^24" }

/** Checks whether `value` is one of `choices`. */
export function isOneOf<T extends string>(choices: readonly T[], value: string): value is T {
  return (choices as readonly string[]).includes(value)
}
