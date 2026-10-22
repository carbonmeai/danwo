/**
 * `danwo doctor`: what stops a first run, checked before one. Node, danwo's own Chromium (and
 * the config's other browsers, when `browser.name` names Firefox or WebKit), the config (loading, and keys danwo does not know), the model's key, the installed Playwright Test
 * against `@danwo/playwright`'s range, and whether the coding agents' copy of the skill is this
 * danwo's. Android has its own: `danwo device doctor`.
 */
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

import { DANWO_VERSION } from "@danwo/init/catalog"
import {
  type BrowserName,
  browserNames,
  browserTitle,
  type DanwoConfig,
  loadConfig,
} from "@danwo/runner/runner"
import { SKILL_DIRS, SKILL_FILE } from "@danwo/skill"

export interface DoctorCheck {
  readonly name: string
  readonly status: "ok" | "warn" | "fail"
  readonly detail: string
}

/** What the checks read from the machine; replaced in tests. */
export interface DoctorProbes {
  readonly nodeVersion: string
  readonly env: NodeJS.ProcessEnv
  /** Starts danwo's build of `engine` headless; its version or why it did not start. */
  readonly browser: (
    engine: BrowserName,
  ) => Promise<{ readonly ok: boolean; readonly detail: string }>
}

/** The oldest Playwright Test `@danwo/playwright` takes. */
const PLAYWRIGHT_FLOOR = [1, 60] as const

/** The variable each model provider's AI SDK package reads its key from, by provider prefix. */
const PROVIDER_KEYS: readonly (readonly [string, string])[] = [
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
  ["google", "GOOGLE_GENERATIVE_AI_API_KEY"],
  ["gateway", "AI_GATEWAY_API_KEY"],
]

function nodeCheck(version: string): DoctorCheck {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0)

  return major >= 24
    ? { name: "Node.js", status: "ok", detail: version }
    : { name: "Node.js", status: "fail", detail: `${version}; danwo needs Node.js 24 or newer` }
}

async function browserCheck(probes: DoctorProbes, engine: BrowserName): Promise<DoctorCheck> {
  const found = await probes.browser(engine)
  const name = browserTitle(engine)

  return found.ok
    ? { name, status: "ok", detail: found.detail }
    : { name, status: "fail", detail: found.detail.replace(/^browserType\.launch: /, "") }
}

/** The engines a project needs: Chromium always (`danwo record` and the MCP server run on it), then the config's others. */
function enginesOf(config: DanwoConfig | undefined): BrowserName[] {
  const named = config?.browser?.name

  return [
    ...new Set<BrowserName>([
      "chromium",
      ...(named === undefined
        ? []
        : browserNames(typeof named === "string" ? [named] : named, "browser.name")),
    ]),
  ]
}

/** The key variable a model needs, by its provider, when danwo can tell. */
function modelKeyOf(model: DanwoConfig["model"]): string | undefined {
  if (typeof model === "string") return "AI_GATEWAY_API_KEY"

  const named: unknown = typeof model === "object" ? Reflect.get(model, "provider") : undefined
  const provider = typeof named === "string" ? named : ""

  return PROVIDER_KEYS.find(([prefix]) => provider.startsWith(prefix))?.[1]
}

function modelCheck(config: DanwoConfig, env: NodeJS.ProcessEnv): DoctorCheck {
  if (config.model === undefined)
    return { name: "model", status: "ok", detail: "none set: agent steps are off" }

  const key = modelKeyOf(config.model)

  if (key === undefined)
    return { name: "model", status: "ok", detail: "set; its key is not checked here" }
  if ((env[key] ?? "") !== "") return { name: "model", status: "ok", detail: `${key} is set` }

  return {
    name: "model",
    status: "warn",
    detail: `${key} is not set in this shell; agent steps fail without it unless the config passes the key itself`,
  }
}

/** The config's checks: it loads, its keys, and the model's key. */
async function configChecks(
  cwd: string,
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<{ checks: DoctorCheck[]; root: string; config?: DanwoConfig }> {
  try {
    const loaded = await loadConfig(cwd, explicit)

    if (loaded.path === undefined)
      return {
        root: cwd,
        checks: [
          {
            name: "config",
            status: "warn",
            detail: "no danwo.config.ts here or above; npx @danwo/cli init writes one",
          },
        ],
      }

    const keys = (loaded.warnings ?? []).map((warning): DoctorCheck => ({
      name: "config",
      status: "warn",
      detail: warning,
    }))

    return {
      root: loaded.root,
      config: loaded.config,
      checks: [
        { name: "config", status: "ok", detail: loaded.path },
        ...keys,
        modelCheck(loaded.config, env),
      ],
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    return { root: cwd, checks: [{ name: "config", status: "fail", detail }] }
  }
}

/** The Playwright Test the project installed, against the range `@danwo/playwright` takes. */
function playwrightCheck(root: string): DoctorCheck[] {
  let version: string

  try {
    const require = createRequire(join(root, "package.json"))
    const pkg: unknown = JSON.parse(
      readFileSync(require.resolve("@playwright/test/package.json"), "utf8"),
    )

    version = String(Reflect.get(Object(pkg), "version"))
  } catch {
    return []
  }

  const [major = 0, minor = 0] = version.split(".").map(Number)
  const fits = major === PLAYWRIGHT_FLOOR[0] && minor >= PLAYWRIGHT_FLOOR[1]

  return [
    fits
      ? { name: "@playwright/test", status: "ok", detail: version }
      : {
          name: "@playwright/test",
          status: "fail",
          detail: `${version}; @danwo/playwright takes ${PLAYWRIGHT_FLOOR.join(".")}.0 to 1.x`,
        },
  ]
}

/** Whether each copy of danwo's skill in the project is this danwo's. */
function skillChecks(root: string): DoctorCheck[] {
  const shipped = readFileSync(SKILL_FILE, "utf8")

  return SKILL_DIRS.flatMap((dir): DoctorCheck[] => {
    const file = join(root, dir, "SKILL.md")

    if (!existsSync(file)) return []
    if (readFileSync(file, "utf8") === shipped)
      return [{ name: "skill", status: "ok", detail: `${dir} is danwo ${DANWO_VERSION}'s` }]

    return [
      {
        name: "skill",
        status: "warn",
        detail: `${dir} differs from danwo ${DANWO_VERSION}'s (an older danwo wrote it, or it was edited); danwo init updates a copy nobody edited`,
      },
    ]
  })
}

/** Every check, in the order a first run meets them. */
export async function projectDoctor(
  options: { readonly cwd: string; readonly config?: string | undefined },
  probes: DoctorProbes,
): Promise<DoctorCheck[]> {
  const config = await configChecks(options.cwd, options.config, probes.env)
  const browsers: DoctorCheck[] = []

  for (const engine of enginesOf(config.config)) browsers.push(await browserCheck(probes, engine))

  return [
    nodeCheck(probes.nodeVersion),
    { name: "danwo", status: "ok", detail: DANWO_VERSION },
    ...browsers,
    ...config.checks,
    ...playwrightCheck(config.root),
    ...skillChecks(config.root),
  ]
}

/** The checks as lines, one each, the way `danwo device doctor` prints them. */
export function doctorLines(checks: readonly DoctorCheck[]): string[] {
  return checks.map((check) => `${check.status.padEnd(4)}  ${check.name}: ${check.detail}`)
}
