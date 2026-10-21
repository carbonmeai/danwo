import { Octokit } from "@octokit/rest"

import { createEmulator, type Emulator, type EmulatorOptions } from "../src/define.ts"
import { github, type GithubSeedConfig, seedGithub } from "../src/github/index.ts"
import { fakeKey } from "./fake-key.ts"
import { fetchVia } from "./google-api.ts"

/** Test helpers for the GitHub emulator: seeded people, repositories and apps, and Octokit. */

export const ADA_TOKEN = fakeKey("ghp_", "adaAdaAdaAdaAdaAdaAdaAdaAdaAdaAda01")
export const BOB_TOKEN = fakeKey("ghp_", "bobBobBobBobBobBobBobBobBobBobBob02")
export const ADA_PUBLIC_ONLY = fakeKey("ghp_", "adaPublicPublicPublicPublicPublic3")

export const OAUTH_APP = {
  clientId: "Ov23liOAuthAppClientId",
  clientSecret: "oauth-app-secret-0123456789abcdef",
  callback: "https://app.danwo.test/auth/github/callback",
}

export const BOT = {
  id: 424_242,
  slug: "danwo-bot",
  clientId: "Iv23liDanwoBotClientId",
  clientSecret: "bot-secret-0123456789abcdef",
  webhookSecret: "bot-webhook-secret",
  callback: "https://bot.danwo.test/auth/callback",
}

export const INSTALLATION_ID = 777_001

/** People, an organisation, repositories and the two apps every GitHub test starts from. */
const SEED: GithubSeedConfig = {
  users: [
    { login: "ada", name: "Ada Lovelace", emails: ["ada@danwo.test", "ada@work.test"] },
    { login: "bob", name: "Bob Builder", emails: ["bob@danwo.test"] },
  ],
  orgs: [{ login: "acme", name: "Acme", members: ["ada"] }],
  repos: [
    {
      repo: "acme/widgets",
      description: "Widgets",
      files: { "README.md": "# widgets\n", "src/index.ts": "export {}\n" },
    },
    { repo: "acme/secret", private: true, files: { "notes.txt": "private\n" } },
    { repo: "ada/notes", files: { "todo.md": "- write tests\n" } },
  ],
  oauthApps: [
    {
      clientId: OAUTH_APP.clientId,
      clientSecret: OAUTH_APP.clientSecret,
      name: "Danwo Sync",
      callbackUrls: [OAUTH_APP.callback],
    },
  ],
  apps: [
    {
      id: BOT.id,
      slug: BOT.slug,
      name: "Danwo Bot",
      owner: "acme",
      clientId: BOT.clientId,
      clientSecret: BOT.clientSecret,
      webhookUrl: "https://bot.danwo.test/webhooks",
      webhookSecret: BOT.webhookSecret,
      permissions: { issues: "write", checks: "write", contents: "read", pull_requests: "write" },
      events: ["issues", "issue_comment", "pull_request", "check_run"],
      callbackUrls: [BOT.callback],
      expiringUserTokens: true,
    },
  ],
  installations: [
    { id: INSTALLATION_ID, app: BOT.slug, account: "acme", repositories: ["widgets"] },
  ],
  tokens: [
    { token: ADA_TOKEN, login: "ada", scopes: ["repo", "user", "admin:repo_hook"] },
    { token: BOB_TOKEN, login: "bob", scopes: ["public_repo"] },
    { token: ADA_PUBLIC_ONLY, login: "ada", scopes: ["public_repo"] },
  ],
}

/** A GitHub emulator with the standard seed, plus `extra`. */
export function githubWith(extra: GithubSeedConfig = {}, options: EmulatorOptions = {}): Emulator {
  const emulator = createEmulator(github, options)

  seedGithub(emulator.store, SEED)
  seedGithub(emulator.store, extra)

  return emulator
}

/** File content as the contents API takes it. */
export const base64 = (text: string) => Buffer.from(text).toString("base64")

const quiet = () => undefined

/** An Octokit logger that keeps expected refusals out of the test output. */
export const SILENT = { debug: quiet, info: quiet, warn: quiet, error: quiet }

/** Octokit sending every request to the emulator, with `auth` as its token or JWT. */
export function octokitFor(emulator: Emulator, auth?: string): Octokit {
  return new Octokit({ ...(auth && { auth }), request: { fetch: fetchVia(emulator) }, log: SILENT })
}

/** A delivery's JSON body, as the plain object the test reads fields from. */
export function payloadOf(delivery: Delivery | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(delivery?.body ?? "{}")

  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** The HTTP status of a failed Octokit call, and GitHub's message. */
export async function refusal(
  call: Promise<unknown>,
): Promise<{ status: number; message: string }> {
  try {
    await call
  } catch (error) {
    if (!(error instanceof Error) || !("status" in error) || typeof error.status !== "number")
      throw error

    return { status: error.status, message: messageOf(error) }
  }

  throw new Error("expected the call to fail")
}

/** GitHub's `message` from an Octokit error's response body, if there is one. */
function messageOf(error: Error): string {
  const response = "response" in error ? error.response : undefined
  const data: unknown =
    typeof response === "object" && response !== null && "data" in response
      ? response.data
      : undefined

  return typeof data === "object" && data !== null && "message" in data ? String(data.message) : ""
}

/** One webhook the emulator delivered: where, its headers and its body. */
export interface Delivery {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
}

/** Emulator options that capture webhook deliveries instead of sending them. */
export function capturing(): {
  readonly deliveries: Delivery[]
  readonly options: EmulatorOptions
} {
  const deliveries: Delivery[] = []

  return {
    deliveries,
    options: {
      fetch: async (input, init) => {
        const headers = Object.fromEntries(new Headers(init?.headers))

        deliveries.push({
          url: input instanceof Request ? input.url : input.toString(),
          headers,
          body: typeof init?.body === "string" ? init.body : "",
        })

        return new Response(null, { status: 204 })
      },
    },
  }
}

/** Waits until the dispatcher has attempted `count` deliveries. */
export async function delivered(emulator: Emulator, count: number): Promise<void> {
  const deadline = Date.now() + 5000

  while ((emulator.webhooks?.attempts().length ?? 0) < count && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5))
  await emulator.webhooks?.idle()
}
