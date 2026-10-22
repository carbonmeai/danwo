/**
 * The environment that routes a Node app through the proxy, and the ways it can be lost and kept:
 * a start script that sets its own NODE_OPTIONS drops the preload, so a `node` shim first on PATH
 * loads it whatever NODE_OPTIONS says, and every process that loaded it leaves a heartbeat that
 * says whether its calls reached the proxy's probe host.
 */
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { APP_CLOCK_VARIABLE, type AppClock } from "./app-clock.ts"

const PRELOAD = fileURLToPath(new URL("../preload.mjs", import.meta.url))

/** Where each process that loaded the preload leaves a file named after its pid. */
export const PRELOAD_DIR_VARIABLE = "DANWO_PRELOAD_DIR"

/** The URL the preload calls at start to check that the process goes through the proxy. */
const PROBE_VARIABLE = "DANWO_PROXY_PROBE"

/** Set to `1`, a process the probe finds unrouted exits at once instead of running on. */
const REQUIRE_VARIABLE = "DANWO_REQUIRE_PROXY"

/**
 * The host the proxy answers for the preload's check, with `PROBE_HEADER`. `.invalid` never
 * resolves, so a process that calls it directly gets no answer.
 */
export const PROBE_HOST = "proxy-probe.danwo.invalid"

/** The header, set to `1`, that marks the probe host's answer as the proxy's. */
export const PROBE_HEADER = "x-danwo-probe"

/** The preload's `file:` URL, for the shim. */
const PRELOAD_URL_VARIABLE = "DANWO_PRELOAD_URL"

/**
 * A `node` that runs the next `node` on PATH with the preload imported: scripts that start their
 * server as `NODE_OPTIONS=--max-old-space-size=8192 nest start` replace danwo's NODE_OPTIONS, and
 * their `#!/usr/bin/env node` still reaches this. The app keeps its own Node version.
 */
const SHIM = `#!/bin/sh
# danwo: every node started from PATH loads the proxy preload, whatever NODE_OPTIONS says.
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IFS=:
for dir in $PATH; do
  [ "$dir" = "$self_dir" ] && continue
  if [ -x "$dir/node" ]; then exec "$dir/node" --import="$${PRELOAD_URL_VARIABLE}" "$@"; fi
done
echo "danwo: no node on PATH besides its shim" >&2
exit 127
`

/** Writes the `node` shim into `<dir>/bin` and returns that folder. */
export async function writeNodeShim(dir: string): Promise<string> {
  const bin = join(dir, "bin")
  const shim = join(bin, "node")

  await mkdir(bin, { recursive: true })
  await writeFile(shim, SHIM)
  await chmod(shim, 0o755)

  return bin
}

/** What `proxyEnvironment` builds the environment from. */
export interface ProxyEnvironmentInputs {
  readonly url: string
  readonly caCertPath: string
  readonly clock: AppClock
  readonly preloadDir: string
  readonly shimDir: string
}

/** How `env()` routes an app. */
export interface EnvOptions {
  /**
   * Put a `node` shim first on PATH that loads the preload even when the app's start script
   * replaces NODE_OPTIONS. Default true; off on Windows, where there is no shim.
   */
  readonly nodeShim?: boolean
  /**
   * Make a Node process whose calls do not reach the proxy (it runs a Node the preload cannot
   * route) exit at start, before it can call a real provider. Default false: it warns on stderr.
   */
  readonly requireProxy?: boolean
}

/**
 * The proxy's own address, as `NO_PROXY` entries. A client that proxies a request itself (axios
 * reads HTTP_PROXY) sends it to the proxy's address; without these entries the app's agent, which
 * the preload makes proxy-aware too, proxies that request a second time, and the proxy receives a
 * request for itself and refuses it as a loop.
 */
function ownAddresses(url: string): string[] {
  const { port } = new URL(url)

  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
}

/**
 * The `NODE_OPTIONS` entry that imports the preload at `path`. Its `file:` URL percent-encodes
 * spaces and quotes, so a path like `/Users/Jane Doe/app` stays one option.
 */
export function nodeImportOption(path: string): string {
  return `--import=${pathToFileURL(path).href}`
}

/**
 * The `BUN_OPTIONS` entry that preloads `path`. Bun splits the variable on whitespace, so a path
 * with a space or a quote goes in as one double-quoted option. Inside quotes Bun reads a backslash
 * as an escape, so a quoted Windows path takes forward slashes, which Bun accepts there too.
 */
export function bunPreloadOption(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!/[\s"']/.test(path)) return `--preload=${path}`

  const slashed = platform === "win32" ? path.replaceAll("\\", "/") : path

  return `"--preload=${slashed.replaceAll('"', '\\"')}"`
}

/**
 * The proxy variables, CA and preload over `base`, as `Proxy.env()` returns them. The preload
 * leads `BUN_OPTIONS`: Bun misreads a quoted option that follows a bare flag such as `--smol`.
 */
export function proxyEnvironment(
  inputs: ProxyEnvironmentInputs,
  base: NodeJS.ProcessEnv,
  options: EnvOptions = {},
): NodeJS.ProcessEnv {
  const preloadUrl = pathToFileURL(PRELOAD).href
  const shim = (options.nodeShim ?? true) && process.platform !== "win32"
  const noProxy = [base.NO_PROXY ?? base.no_proxy, ...ownAddresses(inputs.url)]
    .filter(Boolean)
    .join(",")

  return {
    ...base,
    HTTPS_PROXY: inputs.url,
    HTTP_PROXY: inputs.url,
    https_proxy: inputs.url,
    http_proxy: inputs.url,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    NODE_USE_ENV_PROXY: "1",
    NODE_EXTRA_CA_CERTS: inputs.caCertPath,
    NODE_OPTIONS: [base.NODE_OPTIONS, nodeImportOption(PRELOAD)].filter(Boolean).join(" "),
    BUN_OPTIONS: [bunPreloadOption(PRELOAD), base.BUN_OPTIONS].filter(Boolean).join(" "),
    [APP_CLOCK_VARIABLE]: inputs.clock.file,
    [PRELOAD_DIR_VARIABLE]: inputs.preloadDir,
    [PRELOAD_URL_VARIABLE]: preloadUrl,
    [PROBE_VARIABLE]: `https://${PROBE_HOST}/`,
    ...(options.requireProxy === true && { [REQUIRE_VARIABLE]: "1" }),
    ...(shim && { PATH: [inputs.shimDir, base.PATH].filter(Boolean).join(":") }),
  }
}

/** Whether a process with this pid still runs (a signal ends it before its exit handlers). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

/** A Node process that loaded the preload but whose calls did not reach the proxy. */
export interface UnroutedProcess {
  readonly pid: number
  /** Its Node version, `v22.18.0`. */
  readonly node: string
  /** Its command line, without the `node` itself. */
  readonly command: string
  /** The ways of calling the probe host that missed the proxy, each with what happened. */
  readonly missed: readonly string[]
  /** What to do about it, for its Node. */
  readonly fix: string
  /** Whether it still runs: under `requireProxy` it has exited. */
  readonly running: boolean
}

/** What a heartbeat file says, as the preload writes it. */
interface Heartbeat {
  readonly routed: boolean
  readonly node: string
  readonly command: string
  readonly missed: readonly string[]
  readonly fix: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** A heartbeat file's contents, or undefined when the preload did not write them. */
export function parseHeartbeat(text: string): Heartbeat | undefined {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }

  if (!isRecord(value) || typeof value.routed !== "boolean") return undefined

  return {
    routed: value.routed,
    node: typeof value.node === "string" ? value.node : "unknown",
    command: typeof value.command === "string" ? value.command : "",
    missed: Array.isArray(value.missed)
      ? value.missed.filter((entry): entry is string => typeof entry === "string")
      : [],
    fix: typeof value.fix === "string" ? value.fix : "",
  }
}

/** Every heartbeat in `preloadDir`, by pid. */
async function heartbeats(preloadDir: string): Promise<ReadonlyMap<number, Heartbeat>> {
  const names = await readdir(preloadDir).catch(() => [])
  const found = new Map<number, Heartbeat>()

  for (const name of names) {
    const pid = Number(name)

    if (!Number.isInteger(pid) || pid <= 0) continue

    const beat = parseHeartbeat(await readFile(join(preloadDir, name), "utf8").catch(() => ""))

    if (beat !== undefined) found.set(pid, beat)
  }

  return found
}

/**
 * The pids of the processes that loaded the preload, reached the proxy through it, and are still
 * running.
 */
export async function preloadedPids(preloadDir: string): Promise<readonly number[]> {
  return [...(await heartbeats(preloadDir))]
    .filter(([pid, beat]) => beat.routed && alive(pid))
    .map(([pid]) => pid)
}

/** The processes that loaded the preload and found that their calls do not reach the proxy. */
export async function unroutedProcesses(preloadDir: string): Promise<readonly UnroutedProcess[]> {
  return [...(await heartbeats(preloadDir))]
    .filter(([, beat]) => !beat.routed)
    .map(([pid, beat]) => ({
      pid,
      node: beat.node,
      command: beat.command,
      missed: beat.missed,
      fix: beat.fix,
      running: alive(pid),
    }))
}
