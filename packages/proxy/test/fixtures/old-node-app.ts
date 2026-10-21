/**
 * Calls a routed host every way a Node app can, on whatever Node runs it: fetch, the default
 * https and http agents, and a fresh https.Agent (as SDKs build their own); with a second argument,
 * also a URL that NO_PROXY sends straight to its host. Prints what each call got, as JSON.
 *
 * Old Nodes cannot strip types, so the test strips them (`stripTypeScriptTypes`) and runs the
 * result as a `.mjs`: only erasable syntax here.
 */
import http from "node:http"
import https from "node:https"

const TIMEOUT_MS = 5_000

function settle(promise: Promise<string>): Promise<string> {
  return Promise.race([
    promise,
    new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), TIMEOUT_MS)),
  ])
}

function failure(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error

  if (cause instanceof Error) return "code" in cause ? String(cause.code) : cause.message

  return String(cause)
}

function get(mod: typeof http | typeof https, url: string, agent?: http.Agent): Promise<string> {
  return new Promise((resolve) => {
    mod
      .get(url, agent === undefined ? {} : { agent }, (response) => {
        let body = ""

        response.on("data", (chunk: Buffer) => (body += chunk.toString()))
        response.on("end", () => resolve(`${response.statusCode} ${body}`))
      })
      .on("error", (error) => resolve(`error ${failure(error)}`))
  })
}

const host = process.argv[2] ?? "api.danwo.test"
const direct = process.argv[3]

const out = {
  node: process.version,
  fetch: await settle(
    fetch(`https://${host}/fetch`).then(
      async (response) => `${response.status} ${await response.text()}`,
      (error: unknown) => `error ${failure(error)}`,
    ),
  ),
  https: await settle(get(https, `https://${host}/https`)),
  http: await settle(get(http, `http://${host}/http`)),
  agent: await settle(get(https, `https://${host}/agent`, new https.Agent({ keepAlive: true }))),
  ...(direct !== undefined && { direct: await settle(get(http, direct)) }),
}

process.stdout.write(JSON.stringify(out))
process.exit(0)
