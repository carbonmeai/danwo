/**
 * Starts the dashboard for a project: a local web server, on 127.0.0.1 only, that reads the
 * project's `.danwo` folder and never writes to it. Runs started from its pages go through the
 * danwo CLI, which writes as any run does.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import type { Server } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { nearestConfig } from "@danwo/runner/runner"

import { serveBuilt } from "./built.ts"

export interface DashboardOptions {
  /** The project whose `.danwo` folder to show. */
  readonly root: string
  /** Default 4310; 0 picks a free port. */
  readonly port?: number
  /** The danwo CLI runs started from the dashboard use; default the one installed beside it. */
  readonly cli?: string
}

export interface Dashboard {
  readonly url: string
  close(): Promise<void>
}

const CONFIG = fileURLToPath(new URL("../vite.config.ts", import.meta.url))
/** What `bun run build` writes; the published package carries it instead of the source. */
const BUILT = fileURLToPath(new URL("../dist/", import.meta.url))
/** The CLI beside this package, in the workspace and once installed alike. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli", "bin", "danwo.mjs")
const DEFAULT_PORT = 4310

/** The server's local URL once it listens. */
function urlOf(server: Pick<Server, "address"> | null | undefined): string {
  const address = server?.address()

  if (address === null || address === undefined || typeof address === "string")
    throw new Error("the dashboard did not start listening")

  return `http://127.0.0.1:${address.port}/`
}

/** The dashboard from its source under Vite's dev server, as it runs in danwo's repository. */
async function fromSource(port: number): Promise<Dashboard> {
  const { createServer } = await import("vite")
  const server = await createServer({
    configFile: CONFIG,
    logLevel: "warn",
    clearScreen: false,
    server: { host: "127.0.0.1", port, strictPort: port !== 0 },
  })

  await server.listen()

  return { url: urlOf(server.httpServer), close: () => server.close() }
}

/** The dashboard from its build, as an installed danwo runs it. */
async function fromBuild(port: number): Promise<Dashboard> {
  const server = await serveBuilt(BUILT, port)

  return {
    url: urlOf(server),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

/**
 * Starts the dashboard: from source where its Vite config is (danwo's own repository), else from
 * the build the package ships.
 */
export async function startDashboard(options: DashboardOptions): Promise<Dashboard> {
  process.env.DANWO_PROJECT_ROOT = options.root
  process.env.DANWO_CLI_BIN = options.cli ?? CLI

  const port = options.port ?? DEFAULT_PORT

  if (existsSync(CONFIG)) return fromSource(port)
  if (!existsSync(join(BUILT, "server", "server.js")))
    throw new Error(`the dashboard has neither its source nor its build at ${BUILT}`)

  return fromBuild(port)
}

export interface ServeOptions {
  readonly cwd?: string
  readonly config?: string
  readonly port?: number
  /** Opens the dashboard in the default browser too. */
  readonly open?: boolean
  readonly write?: (line: string) => void
}

const OPENER: Readonly<Record<string, string>> = { darwin: "open", win32: "explorer" }

/**
 * `danwo serve`: starts the dashboard for the project around `cwd` (the folder of its
 * `danwo.config.ts`, else `cwd` itself) and says where it is.
 */
export async function serveDashboard(options: ServeOptions = {}): Promise<Dashboard> {
  const cwd = options.cwd ?? process.cwd()
  const config = options.config ?? nearestConfig(cwd)
  const root = config === undefined ? cwd : dirname(config)
  const dashboard = await startDashboard({
    root,
    ...(options.port !== undefined && { port: options.port }),
  })
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))

  write(`danwo dashboard for ${root}`)
  write(dashboard.url)

  if (options.open)
    spawn(OPENER[process.platform] ?? "xdg-open", [dashboard.url], {
      detached: true,
      stdio: "ignore",
    }).unref()

  return dashboard
}
