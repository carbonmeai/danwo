/**
 * The environment that routes a Node app through the proxy, and the ways it can be lost and kept:
 * a start script that sets its own NODE_OPTIONS drops the preload, so a `node` shim first on PATH
 * loads it whatever NODE_OPTIONS says, and every process that loaded it leaves a heartbeat.
 */
import { chmod, mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { APP_CLOCK_VARIABLE, type AppClock } from "./app-clock.ts"

const PRELOAD = fileURLToPath(new URL("../preload.mjs", import.meta.url))

/** Where each process that loaded the preload leaves a file named after its pid. */
export const PRELOAD_DIR_VARIABLE = "DANWO_PRELOAD_DIR"

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
}

/** The proxy variables, CA and preload over `base`, as `Proxy.env()` returns them. */
export function proxyEnvironment(
  inputs: ProxyEnvironmentInputs,
  base: NodeJS.ProcessEnv,
  options: EnvOptions = {},
): NodeJS.ProcessEnv {
  const preloadUrl = pathToFileURL(PRELOAD).href
  const shim = (options.nodeShim ?? true) && process.platform !== "win32"

  return {
    ...base,
    HTTPS_PROXY: inputs.url,
    HTTP_PROXY: inputs.url,
    https_proxy: inputs.url,
    http_proxy: inputs.url,
    NODE_USE_ENV_PROXY: "1",
    NODE_EXTRA_CA_CERTS: inputs.caCertPath,
    NODE_OPTIONS: [base.NODE_OPTIONS, `--import=${preloadUrl}`].filter(Boolean).join(" "),
    BUN_OPTIONS: [base.BUN_OPTIONS, `--preload=${PRELOAD}`].filter(Boolean).join(" "),
    [APP_CLOCK_VARIABLE]: inputs.clock.file,
    [PRELOAD_DIR_VARIABLE]: inputs.preloadDir,
    [PRELOAD_URL_VARIABLE]: preloadUrl,
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

/** The pids of the processes that loaded the preload and are still running. */
export async function preloadedPids(preloadDir: string): Promise<readonly number[]> {
  const names = await readdir(preloadDir).catch(() => [])

  return names.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0 && alive(pid))
}
