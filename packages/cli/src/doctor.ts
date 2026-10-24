/**
 * `danwo doctor`: what stops a first run, checked before one. Node, danwo's own Chromium (and
 * the config's other browsers, when `browser.name` names Firefox or WebKit), the config (loading, and keys danwo does not know), the model's key (or, for a model on a coding CLI, the CLI's install and sign-in), the installed Playwright Test
 * against `@danwo/playwright`'s range, and whether the coding agents' copy of the skill is this
 * danwo's. A config that runs its tests on devices (`withIosDevice`, `buildAndroid` and the other
 * `@danwo/mobile` helpers) gets `danwo device doctor`'s checks for each platform it runs on, and
 * Flutter's for a Flutter app. Last, the optional packages: which are installed, the features each
 * enables, and the command that adds one the project lacks.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { DANWO_VERSION } from "@danwo/init/catalog"
import {
  addCommand,
  type BrowserName,
  browserNames,
  browserTitle,
  cliStatusOf,
  type DanwoConfig,
  loadConfig,
  OPTIONAL_PACKAGE_NAMES,
  OPTIONAL_PACKAGES,
  type OptionalPackage,
  PackageMissingError,
} from "@danwo/runner/runner"
import { SKILL_DIRS, SKILL_FILE } from "@danwo/skill"

export interface DoctorCheck {
  readonly name: string
  readonly status: "ok" | "warn" | "fail"
  readonly detail: string
}

/** A platform a mobile config runs its tests on. */
export type MobilePlatform = "android" | "ios"

/** What the checks read from the machine; replaced in tests. */
export interface DoctorProbes {
  readonly nodeVersion: string
  readonly env: NodeJS.ProcessEnv
  /** Starts danwo's build of `engine` headless; its version or why it did not start. */
  readonly browser: (
    engine: BrowserName,
  ) => Promise<{ readonly ok: boolean; readonly detail: string }>
  /** `danwo device doctor`'s checks for one platform, for a config that runs on devices. */
  readonly device: (platform: MobilePlatform) => Promise<readonly DoctorCheck[]>
  /** Flutter's check, for a project with a `pubspec.yaml`. */
  readonly flutter: () => Promise<readonly DoctorCheck[]>
  /** The version of an optional danwo package this danwo loads, or undefined when there is none. */
  readonly installed: (name: OptionalPackage) => string | undefined
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

/**
 * A model that runs on a coding CLI: the CLI is installed, its version, and whether its own status
 * command says it is signed in. Nothing here reads the CLI's credentials.
 */
async function cliChecks(model: DanwoConfig["model"]): Promise<DoctorCheck[] | undefined> {
  const pending = cliStatusOf(model)

  if (pending === undefined) return undefined

  const cli = await pending
  const runsOn: DoctorCheck = {
    name: "model",
    status: "ok",
    detail: `runs on the ${cli.title}, signed in with a plan; no API key`,
  }

  if (!cli.installed) return [runsOn, { name: cli.title, status: "fail", detail: cli.detail }]

  return [
    runsOn,
    { name: cli.title, status: "ok", detail: cli.version ?? "installed" },
    cli.signedIn === true
      ? { name: `${cli.title} sign-in`, status: "ok", detail: cli.detail }
      : {
          name: `${cli.title} sign-in`,
          status: "fail",
          detail: `not signed in; run \`${cli.login}\` once in a terminal`,
        },
  ]
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
): Promise<{
  checks: DoctorCheck[]
  root: string
  config?: DanwoConfig
  path?: string
  /** The optional package the config imports and the project lacks. */
  missing?: OptionalPackage
}> {
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
      path: resolve(cwd, loaded.path),
      checks: [
        { name: "config", status: "ok", detail: loaded.path },
        ...keys,
        ...((await cliChecks(loaded.config.model)) ?? [modelCheck(loaded.config, env)]),
      ],
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    return {
      root: cwd,
      checks: [{ name: "config", status: "fail", detail }],
      ...(error instanceof PackageMissingError && { missing: error.package }),
    }
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

/** The `@danwo/mobile` helpers that put a config's tests on each platform's devices. */
const DEVICE_HELPERS: Readonly<Record<MobilePlatform, RegExp>> = {
  ios: /\b(withIosDevice|buildIos|useSimulator|iosDevice)\b/,
  android: /\b(withAndroidDevice|buildAndroid|useEmulator|androidDevice)\b/,
}

const TITLES: Readonly<Record<MobilePlatform, string>> = { ios: "iOS", android: "Android" }

/** A file's text, or nothing when it cannot be read. */
function textOf(file: string): string {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

/**
 * The platforms a config runs on, from the device helpers its source calls: the config file's own,
 * and the local modules it imports, such as a `tests/stack/device.ts` holding the binding.
 */
function mobilePlatformsOf(configFile: string): MobilePlatform[] {
  const own = textOf(configFile)
  const imported = [...own.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].map((match) =>
    textOf(resolve(dirname(configFile), match[1] ?? "")),
  )
  const source = [own, ...imported].join("\n")

  return (["ios", "android"] as const).filter((platform) => DEVICE_HELPERS[platform].test(source))
}

/** Whether the project holds a Flutter app: a `pubspec.yaml` at its root or one folder down. */
function hasFlutterApp(root: string): boolean {
  if (existsSync(join(root, "pubspec.yaml"))) return true

  try {
    return readdirSync(root, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules" &&
        existsSync(join(root, entry.name, "pubspec.yaml")),
    )
  } catch {
    return false
  }
}

/**
 * The device checks a mobile config needs: each platform it runs on, and Flutter for a Flutter
 * app. A config that runs on both platforms passes on a machine ready for one; the other's
 * failures are warnings that say which platform they hold back.
 */
async function deviceChecks(
  configFile: string | undefined,
  root: string,
  probes: DoctorProbes,
): Promise<DoctorCheck[]> {
  const platforms = configFile === undefined ? [] : mobilePlatformsOf(configFile)

  if (platforms.length === 0) return []
  /* Without the device driver, its line among the optional packages says what to install. */
  if (probes.installed("@danwo/mobile") === undefined) return []

  const found = await Promise.all(
    platforms.map(async (platform) => ({ platform, checks: await probes.device(platform) })),
  )
  const ready = found.some(({ checks }) => checks.every((check) => check.status !== "fail"))
  const devices = found.flatMap(({ platform, checks }) =>
    checks.map((check): DoctorCheck =>
      check.status === "fail" && ready && platforms.length > 1
        ? {
            name: check.name,
            status: "warn",
            detail: `${check.detail} (needed only to run on ${TITLES[platform]})`,
          }
        : { name: check.name, status: check.status, detail: check.detail },
    ),
  )

  return [
    {
      name: "devices",
      status: "ok",
      detail: `the config runs on ${platforms.map((platform) => TITLES[platform]).join(" and ")}`,
    },
    ...devices,
    ...(hasFlutterApp(root) ? await probes.flutter() : []),
  ]
}

/** Whether the project registers danwo's MCP server with a coding agent, as `danwo init` does. */
function registersMcp(root: string): boolean {
  return [".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json", ".codex/config.toml"].some((file) =>
    /"danwo"\s*:|\[mcp_servers\.danwo\]/.test(textOf(join(root, file))),
  )
}

/** Why the project needs an optional package it may lack, and how bad lacking it is. */
interface Need {
  readonly status: "warn" | "fail"
  readonly why: string
}

/**
 * Each optional package: the version installed and the features it enables, or that it is not
 * installed and the command that adds it. One the project needs and lacks fails or warns, as
 * `needed` says; one at another version than this danwo's warns, since danwo's packages are
 * released together.
 */
function optionalChecks(
  root: string,
  needed: ReadonlyMap<OptionalPackage, Need>,
  probes: DoctorProbes,
): DoctorCheck[] {
  return OPTIONAL_PACKAGE_NAMES.map((name): DoctorCheck => {
    const version = probes.installed(name)
    const add = addCommand(name, root)
    const need = needed.get(name)

    if (version === undefined)
      return need === undefined
        ? {
            name,
            status: "ok",
            detail: `not installed; needed only for ${OPTIONAL_PACKAGES[name]}: ${add}`,
          }
        : { name, status: need.status, detail: `not installed; ${need.why}: ${add}` }

    if (version !== DANWO_VERSION && DANWO_VERSION !== "0.0.0")
      return {
        name,
        status: "warn",
        detail: `${version}, but danwo is ${DANWO_VERSION}; install the same version: ${add}`,
      }

    return { name, status: "ok", detail: `${version}: ${OPTIONAL_PACKAGES[name]}` }
  })
}

/**
 * The optional packages the project needs: the config imports them or runs on devices, or its
 * coding agents start danwo's MCP server.
 */
function neededPackages(config: {
  readonly path?: string
  readonly root: string
  readonly missing?: OptionalPackage
}): Map<OptionalPackage, Need> {
  const needed = new Map<OptionalPackage, Need>()

  if (registersMcp(config.root))
    needed.set("@danwo/mcp", {
      status: "warn",
      why: "the coding agents are set up to start danwo's MCP server",
    })
  if (config.path !== undefined && mobilePlatformsOf(config.path).length > 0)
    needed.set("@danwo/mobile", { status: "fail", why: "the config runs on devices" })
  if (config.missing !== undefined)
    needed.set(config.missing, { status: "fail", why: "the config imports it" })

  return needed
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
    ...(await deviceChecks(config.path, config.root, probes)),
    ...playwrightCheck(config.root),
    ...skillChecks(config.root),
    ...optionalChecks(config.root, neededPackages(config), probes),
  ]
}

/**
 * The version of the optional package `name` this danwo loads: resolved from here, where it is a
 * peer, as the commands that need it import it. Undefined when it is not installed.
 */
export function installedVersion(name: OptionalPackage): string | undefined {
  let entry: string

  try {
    entry = fileURLToPath(import.meta.resolve(name))
  } catch {
    return undefined
  }

  for (let dir = dirname(entry); dirname(dir) !== dir; dir = dirname(dir)) {
    const manifest: unknown = JSON.parse(textOf(join(dir, "package.json")) || "{}")

    if (Reflect.get(Object(manifest), "name") === name) {
      const version: unknown = Reflect.get(Object(manifest), "version")

      return typeof version === "string" ? version : undefined
    }
  }

  return undefined
}

/** The checks as lines, one each, the way `danwo device doctor` prints them. */
export function doctorLines(checks: readonly DoctorCheck[]): string[] {
  return checks.map((check) => `${check.status.padEnd(4)}  ${check.name}: ${check.detail}`)
}
