/**
 * What `danwo init` can tell about a project before asking anything: its package manager, its
 * framework and the command that starts it, where it answers, the providers it uses, the coding
 * agents it already has folders for, and whether danwo is set up there. Only names are read from
 * environment files, never values.
 */
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { basename, join, relative } from "node:path"

import {
  AGENT_INFO,
  AGENTS,
  type AgentId,
  MODEL_SOURCE_INFO,
  PROVIDER_IDS,
  PROVIDERS,
  type ProviderId,
} from "./catalog.ts"
import {
  declaredManager,
  findWorkspace,
  isRecord,
  lockedManager,
  PACKAGE_MANAGERS,
  type PackageManager,
  type Workspace,
} from "./workspace.ts"

export type { PackageManager, Workspace } from "./workspace.ts"

/** A framework danwo recognises, by the dependency that shows it. */
export interface Framework {
  readonly id: string
  readonly label: string
  /** The port its dev server listens on when nothing says otherwise. */
  readonly port: number
}

/** First match wins: Expo before React, meta-frameworks before the Vite they run on. */
const FRAMEWORKS: readonly (Framework & { readonly packages: readonly string[] })[] = [
  { id: "expo", label: "Expo", port: 8081, packages: ["expo"] },
  { id: "next", label: "Next.js", port: 3000, packages: ["next"] },
  {
    id: "tanstack-start",
    label: "TanStack Start",
    port: 3000,
    packages: ["@tanstack/react-start", "@tanstack/solid-start", "@tanstack/start"],
  },
  { id: "react-router", label: "React Router", port: 5173, packages: ["@react-router/dev"] },
  { id: "remix", label: "Remix", port: 5173, packages: ["@remix-run/dev"] },
  { id: "nuxt", label: "Nuxt", port: 3000, packages: ["nuxt"] },
  { id: "astro", label: "Astro", port: 4321, packages: ["astro"] },
  { id: "sveltekit", label: "SvelteKit", port: 5173, packages: ["@sveltejs/kit"] },
  { id: "vite", label: "Vite", port: 5173, packages: ["vite"] },
]

const PLAIN: Framework = { id: "plain", label: "Node app", port: 3000 }

/** Environment files whose variable names show which providers and keys a project uses. */
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.example",
]

/** What the Expo app config says, for the mobile config. */
export interface ExpoApp {
  readonly name?: string
  readonly androidPackage?: string
  readonly scheme?: string
}

export interface Detection {
  readonly root: string
  /** The project's name: its package.json name, or its folder's. */
  readonly name: string
  readonly hasPackageJson: boolean
  readonly packageManager: PackageManager
  /** The workspace the project is a package of, or the root of; undefined for a lone project. */
  readonly workspace: Workspace | undefined
  readonly framework: Framework
  /** The package.json script that starts the app, e.g. `dev`. */
  readonly devScript: string | undefined
  /** The command that starts the app, e.g. `pnpm dev`. */
  readonly devCommand: string
  readonly appUrl: string
  readonly typescript: boolean
  /** Every dependency name, of every kind. */
  readonly dependencies: ReadonlySet<string>
  /** Variable names set to a value in the environment or the project's environment files. */
  readonly envNames: ReadonlySet<string>
  readonly providers: readonly ProviderId[]
  readonly agents: readonly AgentId[]
  /**
   * Where the coding agents' files go: the project, or the folder above it in its workspace whose
   * agent folders (`.claude`, `.cursor`, …) show that the agents are opened there.
   */
  readonly agentRoot: string
  readonly hasConfig: boolean
  readonly expo: ExpoApp | undefined
}

interface PackageJson {
  readonly name?: unknown
  readonly packageManager?: unknown
  readonly scripts?: Readonly<Record<string, unknown>>
  readonly dependencies?: Readonly<Record<string, unknown>>
  readonly devDependencies?: Readonly<Record<string, unknown>>
  readonly peerDependencies?: Readonly<Record<string, unknown>>
}

async function readJson(path: string): Promise<unknown> {
  if (!existsSync(path)) return undefined

  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return undefined
  }
}

/** The project's workspace, and the package manager: the workspace's, or the project's own. */
function managerOf(
  root: string,
  pkg: PackageJson,
  userAgent: string | undefined,
): { workspace: Workspace | undefined; packageManager: PackageManager } {
  const workspace = findWorkspace(root, userAgent)

  return {
    workspace,
    packageManager: workspace?.packageManager ?? packageManagerOf(root, pkg, userAgent),
  }
}

/** The package manager a lone project uses: `packageManager`, a lockfile, or the one running init. */
export function packageManagerOf(
  root: string,
  pkg: PackageJson,
  userAgent: string | undefined,
): PackageManager {
  return (
    declaredManager(pkg) ??
    lockedManager(root) ??
    PACKAGE_MANAGERS.find((pm) => userAgent?.startsWith(`${pm}/`)) ??
    "npm"
  )
}

/** The agents whose folders `folder` has, by their markers. */
function agentsIn(folder: string): AgentId[] {
  return AGENTS.filter((id) => existsSync(join(folder, AGENT_INFO[id].marker)))
}

/**
 * The folder the coding agents work from, and the agents found there: the project's own when it
 * has agent folders, else the nearest folder above it, up to its workspace's root, that has them.
 */
function agentsOf(
  root: string,
  workspace: Workspace | undefined,
): { agentRoot: string; agents: AgentId[] } {
  const own = agentsIn(root)

  if (own.length > 0 || workspace === undefined) return { agentRoot: root, agents: own }

  let folder = root

  while (relative(workspace.root, folder) !== "") {
    folder = join(folder, "..")

    const found = agentsIn(folder)

    if (found.length > 0) return { agentRoot: folder, agents: found }
  }

  return { agentRoot: root, agents: own }
}

/** How `pm` runs a package.json script. */
export function runScript(pm: PackageManager, script: string): string {
  return pm === "npm" || pm === "bun" ? `${pm} run ${script}` : `${pm} ${script}`
}

function dependencyNames(pkg: PackageJson): Set<string> {
  return new Set(
    [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies].flatMap((deps) =>
      isRecord(deps) ? Object.keys(deps) : [],
    ),
  )
}

/** Whether `names` has `wanted`, or, for a wanted name ending in `/`, a package in that scope. */
function hasPackage(names: ReadonlySet<string>, wanted: string): boolean {
  return wanted.endsWith("/")
    ? [...names].some((name) => name.startsWith(wanted))
    : names.has(wanted)
}

export function frameworkOf(dependencies: ReadonlySet<string>): Framework {
  const found = FRAMEWORKS.find((framework) =>
    framework.packages.some((name) => dependencies.has(name)),
  )

  return found ? { id: found.id, label: found.label, port: found.port } : PLAIN
}

/** The script that starts the app for development, when the project has one. */
function devScriptOf(scripts: Readonly<Record<string, unknown>>): string | undefined {
  return ["dev", "start", "serve"].find((name) => typeof scripts[name] === "string")
}

/** The port a script sets with `-p`, `--port` or `PORT=`, when it sets one. */
export function portIn(script: string): number | undefined {
  const match = /(?:--port[ =]|-p[ =]?|PORT=)(\d{2,5})\b/.exec(script)

  return match?.[1] === undefined ? undefined : Number(match[1])
}

/** Variable names: those set to a value, and every name mentioned anywhere (examples too). */
interface EnvNames {
  readonly set: Set<string>
  readonly mentioned: Set<string>
}

/** The names `env` and the project's environment files set; `.env.example` only mentions them. */
async function envNamesOf(root: string, env: NodeJS.ProcessEnv): Promise<EnvNames> {
  const set = new Set(Object.keys(env).filter((name) => (env[name] ?? "") !== ""))
  const mentioned = new Set(set)

  for (const file of ENV_FILES) {
    const path = join(root, file)

    if (!existsSync(path)) continue

    for (const line of (await readFile(path, "utf8")).split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(\S?)/.exec(line)

      if (!match?.[1]) continue
      mentioned.add(match[1])
      if (match[2] !== "" && file !== ".env.example") set.add(match[1])
    }
  }

  return { set, mentioned }
}

/** The providers the dependencies or the variable names show. */
export function providersOf(
  dependencies: ReadonlySet<string>,
  envNames: ReadonlySet<string>,
): ProviderId[] {
  return PROVIDER_IDS.filter((id) => {
    const info = PROVIDERS[id]

    return (
      info.packages.some((name) => hasPackage(dependencies, name)) ||
      info.envNames.some((name) => envNames.has(name))
    )
  })
}

/** `value` when it is a string. */
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

async function expoAppOf(root: string): Promise<ExpoApp | undefined> {
  const config = await readJson(join(root, "app.json"))
  const expo = isRecord(config) && isRecord(config["expo"]) ? config["expo"] : undefined

  if (expo === undefined) return undefined

  const android = isRecord(expo["android"]) ? expo["android"] : {}
  const name = text(expo["name"])
  const androidPackage = text(android["package"])
  const scheme = text(expo["scheme"])

  return {
    ...(name !== undefined && { name }),
    ...(androidPackage !== undefined && { androidPackage }),
    ...(scheme !== undefined && { scheme }),
  }
}

/** Looks at the project in `root`; `env` is where model keys and provider variables are looked for. */
export async function detectProject(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Detection> {
  const raw = await readJson(join(root, "package.json"))
  const pkg: PackageJson = isRecord(raw) ? raw : {}
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {}
  const { workspace, packageManager } = managerOf(root, pkg, env["npm_config_user_agent"])
  const dependencies = dependencyNames(pkg)
  const framework = frameworkOf(dependencies)
  const devScript = devScriptOf(scripts)
  const script = devScript === undefined ? "" : String(scripts[devScript])
  const port = portIn(script) ?? framework.port
  const names = await envNamesOf(root, env)

  return {
    root,
    name: typeof pkg.name === "string" ? pkg.name : basename(root),
    hasPackageJson: isRecord(raw),
    packageManager,
    workspace,
    framework,
    devScript,
    devCommand: devScript === undefined ? "node server.js" : runScript(packageManager, devScript),
    appUrl: `http://localhost:${port}`,
    typescript: existsSync(join(root, "tsconfig.json")) || dependencies.has("typescript"),
    dependencies,
    envNames: names.set,
    providers: providersOf(dependencies, names.mentioned),
    ...agentsOf(root, workspace),
    hasConfig: existsSync(join(root, "danwo.config.ts")),
    expo: framework.id === "expo" ? await expoAppOf(root) : undefined,
  }
}

/** Where `keyEnv` is set: in the environment or one of the project's environment files. */
export function keyFound(detection: Pick<Detection, "envNames">, keyEnv: string): boolean {
  return detection.envNames.has(keyEnv)
}

/** Model sources that take a key, in the order a default prefers them. */
const KEYED_SOURCES = ["gateway", "anthropic", "openai", "google", "openrouter"] as const

/** The model source whose key is already set, for a default that needs no new key. */
export function sourceWithKey(
  detection: Pick<Detection, "envNames">,
): (typeof KEYED_SOURCES)[number] | undefined {
  return KEYED_SOURCES.find((id) => {
    const keyEnv = MODEL_SOURCE_INFO[id].keyEnv

    return keyEnv !== undefined && keyFound(detection, keyEnv)
  })
}
