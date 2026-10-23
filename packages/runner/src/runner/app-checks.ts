/**
 * Three things worth knowing once an app has started behind the proxy: whether each of its Node
 * processes loaded danwo's preload (a start script that sets its own NODE_OPTIONS drops it, and
 * then SDKs with their own agents skip the proxy), whether the processes that loaded it really go
 * through the proxy (the preload's start-up probe says), and whether its environment still holds
 * real provider keys that would reach real providers. None of the checks prints a value. An app
 * that runs no Node at all (Python, Go, Ruby) has no preload to probe from, so danwo says once
 * that the check did not run for it instead of giving a verdict.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { Proxy } from "@danwo/proxy"

import { processRowsAsync, type ProcessRow, programName } from "../support/process-table.ts"

/**
 * `root` and every process below it in `table`. The root counts: a shell that runs one command
 * often execs it in its own place.
 */
function familyOf(table: readonly ProcessRow[], root: number): readonly ProcessRow[] {
  const below: ProcessRow[] = table.filter((row) => row.pid === root)
  const parents = new Set([root])

  for (let grew = true; grew;) {
    grew = false

    for (const row of table) {
      if (parents.has(row.ppid) && !parents.has(row.pid)) {
        parents.add(row.pid)
        below.push(row)
        grew = true
      }
    }
  }

  return below
}

/** A Node process, by the program its command line starts with (`node.exe` on Windows). */
function isNode(command: string): boolean {
  const program = programName(command)

  return program === "node" || program === "nodejs"
}

/** How to keep the preload in a start script that sets NODE_OPTIONS, on `platform`. */
export function keepPreloadAdvice(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? `append danwo's NODE_OPTIONS to its own ("set NODE_OPTIONS=%NODE_OPTIONS% --max-old-space-size=…")`
    : `run it through PATH's node (danwo's shim is on PATH), or append danwo's NODE_OPTIONS ("NODE_OPTIONS=\\"$NODE_OPTIONS --max-old-space-size=…\\"")`
}

/**
 * The Node processes started under `root` (an app's process group) that did not load the preload,
 * as warnings naming each one and the fix.
 */
export async function preloadWarnings(app: string, root: number, proxy: Proxy): Promise<string[]> {
  /* A process that loaded the preload but missed the proxy is `unroutedProblems`'s to report. */
  const accounted = new Set([
    ...(await proxy.preloaded()),
    ...(await proxy.unrouted()).map((row) => row.pid),
  ])
  const missing = familyOf(await processRowsAsync(), root).filter(
    (row) => isNode(row.command) && !accounted.has(row.pid),
  )

  return missing.map(
    (row) =>
      `${app}: process ${row.pid} (${row.command.slice(0, 80)}) runs without danwo's preload, so SDKs with their own HTTP agent call real hosts. Its start script likely sets NODE_OPTIONS itself: ${keepPreloadAdvice()}.`,
  )
}

/**
 * A note for an app that runs no Node process and no process that loaded the preload (a Python or
 * Go server): the start-up check that its calls reach the proxy runs inside the preload, so it
 * does not run for this app, which is neither a pass nor a failure. Empty for an app with any
 * Node or preloaded process, or with none left running (a command that started a service and
 * exited).
 */
async function outsideNodeNotes(app: string, root: number, proxy: Proxy): Promise<string[]> {
  const family = familyOf(await processRowsAsync(), root)
  const preloaded = new Set([
    ...(await proxy.preloaded()),
    ...(await proxy.unrouted()).map((row) => row.pid),
  ])

  if (family.length === 0 || family.some((row) => isNode(row.command) || preloaded.has(row.pid)))
    return []

  const programs = [...new Set(family.map((row) => programName(row.command)))].join(", ")

  return [
    `${app} runs no Node process (${programs}), so danwo's check at start that its calls reach the proxy, which runs inside Node, does not run for it, and nothing confirms its calls go through the proxy: they do when its HTTP clients read HTTPS_PROXY and trust the CA bundle in SSL_CERT_FILE, REQUESTS_CA_BUNDLE or CURL_CA_BUNDLE, which danwo sets. A client that ignores them calls the real hosts, and unmatched: "block" cannot stop it.`,
  ]
}

/** The notes `noteOutsideNode` printed in this process, so each is said once, not per worker run. */
const said = new Set<string>()

/**
 * Prints `outsideNodeNotes` on stderr, each once per process. They describe the app, not a test,
 * so they stay out of the environment's notes, which a matrix repeats under every trial.
 */
export async function noteOutsideNode(app: string, root: number, proxy: Proxy): Promise<void> {
  for (const note of await outsideNodeNotes(app, root, proxy)) {
    if (said.has(note)) continue
    said.add(note)
    process.stderr.write(`danwo: ${note}\n`)
  }
}

/**
 * The app processes whose calls the preload found do not reach the proxy, one line each naming
 * the process, its Node and what missed. Empty when every process that loaded the preload is
 * routed.
 */
export async function unroutedProblems(proxy: Proxy): Promise<string[]> {
  return (await proxy.unrouted()).map((row) =>
    `process ${row.pid}${row.command === "" ? "" : ` (node ${row.command.slice(0, 80)})`} runs Node ${row.node}, and its calls do not go through danwo's proxy (${row.missed.join(", ")} missed it), so they would reach the real providers. ${row.fix}`.trimEnd(),
  )
}

/**
 * Refuses the run when an app process does not go through the proxy and the run's settings say
 * nothing may reach a real provider (`unmatched: "block"`, or `secrets: "fail"`); otherwise
 * prints each problem and returns them, for the run's notes.
 */
export async function checkRouting(proxy: Proxy, strict: boolean): Promise<string[]> {
  const problems = await unroutedProblems(proxy)

  if (problems.length === 0) return []
  if (strict) throw new Error(routingRefusal(problems))
  for (const problem of problems) process.stderr.write(`danwo: ${problem}\n`)

  return problems
}

/** The error a run that refuses unrouted app processes fails with. */
export function routingRefusal(problems: readonly string[]): string {
  return `danwo refuses the run, because an app process does not go through its proxy:\n${problems.join("\n")}`
}

/** A provider's live key, by the shape of its value (and, where shapes are shared, its name). */
interface KeyShape {
  readonly provider: string
  readonly value: RegExp
  readonly name?: RegExp
}

const LIVE_KEYS: readonly KeyShape[] = [
  { provider: "paystack", value: /^sk_live_/, name: /PAYSTACK/i },
  { provider: "clerk", value: /^sk_live_/, name: /CLERK/i },
  { provider: "stripe", value: /^(?:sk|rk)_live_/ },
  { provider: "resend", value: /^re_[A-Za-z0-9_]{16,}$/ },
  { provider: "anthropic", value: /^sk-ant-/ },
  { provider: "openai", value: /^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}$/ },
  { provider: "aws", value: /^(?:AKIA|ASIA)[0-9A-Z]{16}$/ },
  { provider: "github", value: /^(?:ghp_|gho_|ghs_|github_pat_)/ },
  { provider: "slack", value: /^xox[abprs]-/ },
  { provider: "flutterwave", value: /^FLWSECK-(?!.*_TEST)/ },
  { provider: "composio", value: /^ak_[A-Za-z0-9_-]{12,}$/, name: /COMPOSIO/i },
  { provider: "nylas", value: /^nyk_v0_[A-Za-z0-9_-]{16,}$/, name: /NYLAS/i },
  { provider: "gemini", value: /^AIza[0-9A-Za-z_-]{35}$/, name: /GEMINI|GENERATIVE_AI|GOOGLE_AI/i },
  { provider: "google", value: /^AIza[0-9A-Za-z_-]{35}$/ },
  { provider: "perplexity", value: /^pplx-[A-Za-z0-9]{20,}$/ },
  { provider: "bedrock", value: /^ABSK[A-Za-z0-9+/=]{20,}$/ },
  { provider: "twilio", value: /^SK[0-9a-fA-F]{32}$/, name: /TWILIO/i },
  { provider: "novu", value: /^[0-9a-f]{32}$/, name: /NOVU/i },
  { provider: "pusher", value: /^[0-9a-f]{20}$/, name: /PUSHER.*SECRET/i },
]

/** Which danwo services emulate each provider's hosts. */
const EMULATED_BY: Readonly<Record<string, readonly string[]>> = {
  openai: ["llm"],
  anthropic: ["llm"],
  gemini: ["llm"],
  perplexity: ["llm"],
  bedrock: ["llm"],
  aws: ["s3", "aws", "ministack"],
}

/** The provider a variable's value is a live key of, if it is one. */
function liveKeyOf(name: string, value: string): string | undefined {
  return LIVE_KEYS.find((shape) => shape.value.test(value) && (shape.name?.test(name) ?? true))
    ?.provider
}

/** The `.env` files a dev server or `dotenv` loads from an app's folder. */
const ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"]

/** `NAME=value` lines of an env file; comments, `export` and quotes handled. */
function parseEnvFile(text: string): ReadonlyMap<string, string> {
  const vars = new Map<string, string>()

  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)

    if (match?.[1] !== undefined)
      vars.set(match[1], (match[2] ?? "").replace(/^(['"])(.*)\1$/, "$2"))
  }

  return vars
}

/** What the live-key check needs to know about one app. */
export interface KeyCheck {
  readonly app: string
  readonly cwd: string | undefined
  /** The environment the app is started with: the variables the run sets win over its files. */
  readonly env: NodeJS.ProcessEnv
  /** The names of the variables the run sets for the app itself (they override its files). */
  readonly overridden: ReadonlySet<string>
  /** Names of the services behind the proxy. */
  readonly services: ReadonlySet<string>
  /** Whether hosts no service answers pass through to the real ones. */
  readonly passthrough: boolean
}

/**
 * Warnings for live-looking provider keys the app would use against providers danwo does not
 * emulate while unrouted hosts pass through: in the env it is started with, or in the `.env`
 * files its folder holds that the run does not override. Names only, never values.
 */
export async function liveKeyWarnings(check: KeyCheck): Promise<string[]> {
  if (!check.passthrough) return []

  const found: string[] = []

  const flag = (name: string, value: string | undefined, where: string) => {
    const provider = value === undefined ? undefined : liveKeyOf(name, value)
    const emulated = (EMULATED_BY[provider ?? ""] ?? [provider]).some((s) =>
      check.services.has(s ?? ""),
    )

    if (provider !== undefined && !emulated)
      found.push(
        `${check.app}: ${name} (${where}) looks like a live ${provider} key, and ${provider} is not emulated in this run while unrouted hosts pass through: calls would reach the real ${provider} with it. Override ${name}, add the ${provider} service, or set unmatched: "block".`,
      )
  }

  for (const [name, value] of Object.entries(check.env)) flag(name, value, "its environment")

  for (const file of ENV_FILES) {
    const text = await readFile(join(check.cwd ?? ".", file), "utf8").catch(() => undefined)

    if (text === undefined) continue
    for (const [name, value] of parseEnvFile(text))
      if (!check.overridden.has(name) && check.env[name] === undefined) flag(name, value, file)
  }

  return found
}
