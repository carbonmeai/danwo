/**
 * What happened while a worker's environment started, before its first test: the apps' startup
 * output, the calls they made through the proxy, their sockets and danwo's notes about them. A
 * test's flight record only holds what happened during that test, so a stack that fails or warns
 * while booting (a provider it calls at start, a key it is missing) would otherwise leave nothing.
 * It is written once the environment started and again when the worker ends, so it also has what
 * an app wrote between tests (a crash during a reset) and which apps went down.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { WorkerEnvironment } from "./environment.ts"
import { createRedactor } from "./redact.ts"

/** Lines of each app's output kept. */
const KEPT_LINES = 400

/** One call made while the environment started: no headers or bodies, and no query string. */
export interface StartupCall {
  readonly host: string
  readonly method: string
  readonly path: string
  readonly disposition: "routed" | "passthrough" | "blocked"
  readonly client: "browser" | "server" | undefined
  readonly status: number | null
}

/** The file a worker writes next to the run's records: `environment-<worker>.json`. */
export interface EnvironmentRecord {
  readonly worker: number
  readonly writtenAt: string
  readonly notes: readonly string[]
  /** Apps that stopped on their own, e.g. `api exited with code 1`. */
  readonly stopped: readonly string[]
  readonly calls: readonly StartupCall[]
  readonly sockets: readonly Omit<StartupCall, "method" | "status">[]
  /** Each app's output so far, redacted, the last lines only. */
  readonly logs: Readonly<Record<string, readonly string[]>>
}

/** The path without its query string, which can carry tokens. */
function bare(path: string): string {
  return path.split("?")[0] ?? path
}

/**
 * What `env` has seen so far, redacted, as the environment record keeps it: credential shapes,
 * and the secrets `redact` knows (the config's own values, before any test revealed more).
 */
export function environmentRecord(
  env: WorkerEnvironment,
  worker: number,
  redact: (text: string) => string = (text) => text,
): EnvironmentRecord {
  const redactor = createRedactor(redact)
  const exchanges = env.proxy?.exchanges() ?? []
  const sockets = env.proxy?.sockets() ?? []

  return {
    worker,
    writtenAt: new Date().toISOString(),
    notes: (env.notes?.() ?? []).map((note) => redactor.text(note)),
    stopped: (env.stopped?.() ?? []).map((line) => redactor.text(line)),
    calls: exchanges
      .filter((exchange) => exchange.asset !== true)
      .map((exchange) => ({
        host: exchange.host,
        method: exchange.method,
        path: bare(exchange.path),
        disposition: exchange.disposition,
        client: exchange.client,
        status: exchange.status,
      })),
    sockets: sockets.map((socket) => ({
      host: socket.host,
      path: bare(socket.path),
      disposition: socket.disposition,
      client: socket.client,
    })),
    logs: Object.fromEntries(
      Object.entries(env.logs?.() ?? {}).map(([name, log]) => [
        name,
        log.lines.slice(-KEPT_LINES).map((line) => redactor.text(line)),
      ]),
    ),
  }
}

/**
 * Writes the environment record into the run's folder, made if no record made it yet; best
 * effort, as a record never fails a run. A run that keeps no test record is still removed whole.
 */
export async function writeEnvironmentRecord(
  runDir: string,
  env: WorkerEnvironment,
  worker: number,
  redact?: (text: string) => string,
): Promise<void> {
  try {
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, `environment-${worker}.json`),
      `${JSON.stringify(environmentRecord(env, worker, redact), null, 2)}\n`,
    )
  } catch {
    /* The disk may refuse: the tests still run. */
  }
}
