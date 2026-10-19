/**
 * Two things worth knowing once an app has started behind the proxy: whether each of its Node
 * processes loaded danwo's preload (a start script that sets its own NODE_OPTIONS drops it, and
 * then SDKs with their own agents skip the proxy), and whether its environment still holds real
 * provider keys that would reach real providers. Neither check prints a value.
 */
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { promisify } from "node:util"

import type { Proxy } from "@danwo/proxy"

const run = promisify(execFile)

/** One process in the machine's process table. */
interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly command: string
}

async function processTable(): Promise<readonly ProcessRow[]> {
  try {
    const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,command="], { maxBuffer: 8 << 20 })

    return stdout.split("\n").flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)

      return match
        ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }]
        : []
    })
  } catch {
    return []
  }
}

/** Every process below `root` in `table`, the root left out. */
function descendants(table: readonly ProcessRow[], root: number): readonly ProcessRow[] {
  const below: ProcessRow[] = []
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

/** A Node process, by the program its command line starts with. */
function isNode(command: string): boolean {
  const program = basename(command.split(/\s+/, 1)[0] ?? "")

  return program === "node" || program === "nodejs"
}

/**
 * The Node processes started under `root` (an app's process group) that did not load the preload,
 * as warnings naming each one and the fix.
 */
export async function preloadWarnings(app: string, root: number, proxy: Proxy): Promise<string[]> {
  const preloaded = new Set(await proxy.preloaded())
  const missing = descendants(await processTable(), root).filter(
    (row) => isNode(row.command) && !preloaded.has(row.pid),
  )

  return missing.map(
    (row) =>
      `${app}: process ${row.pid} (${row.command.slice(0, 80)}) runs without danwo's preload, so SDKs with their own HTTP agent call real hosts. Its start script likely sets NODE_OPTIONS itself: run it through PATH's node (danwo's shim is on PATH), or append danwo's NODE_OPTIONS ("NODE_OPTIONS=\\"$NODE_OPTIONS --max-old-space-size=…\\"").`,
  )
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
  { provider: "google", value: /^AIza[0-9A-Za-z_-]{35}$/ },
  { provider: "twilio", value: /^SK[0-9a-fA-F]{32}$/, name: /TWILIO/i },
]

/** Which danwo services emulate each provider's hosts. */
const EMULATED_BY: Readonly<Record<string, readonly string[]>> = {
  openai: ["llm"],
  anthropic: ["llm"],
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
