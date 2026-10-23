/**
 * An app outside Node gets no preload: it reaches the proxy through the standard proxy variables,
 * and trusts danwo's CA through the bundle the CA variables name. These run real clients (curl,
 * and Python's standard library) with nothing but `proxy.env()`, where the machine has them.
 */
import { execFile, execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { rootCertificates } from "node:tls"
import { promisify } from "node:util"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { caBundle } from "../src/node-env.ts"
import { type Proxy, startProxy } from "../src/proxy.ts"

const run = promisify(execFile)

/** Whether `command` runs here. */
function has(command: string, args: readonly string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" })

    return true
  } catch {
    return false
  }
}

const python = has("python3", ["--version"])
const curl = has("curl", ["--version"])

/** The host the test's route answers, and one no route answers. */
const ROUTED = "api.danwo.test"
const UNROUTED = "elsewhere.danwo.test"

/** A Python program that fetches `argv[1]` with urllib and prints the status and the body. */
const URLLIB = `
import sys, urllib.request, urllib.error
try:
    with urllib.request.urlopen(sys.argv[1], timeout=10) as res:
        print(res.status, res.read().decode())
except urllib.error.HTTPError as error:
    print(error.code, error.read().decode())
`

let proxy: Proxy

beforeAll(async () => {
  proxy = await startProxy({
    routes: [
      {
        hosts: [ROUTED],
        handler: async (request: Request) =>
          new Response(`hello from ${new URL(request.url).pathname}`),
      },
    ],
    unmatched: "block",
  })
})

afterAll(async () => {
  await proxy.stop()
})

/** Only what a program needs to start, with the proxy's variables over it. */
function appEnv(): NodeJS.ProcessEnv {
  return proxy.env({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" })
}

describe("the environment for an app outside Node", () => {
  it("names the proxy in both cases and the CA bundle in every variable clients read", () => {
    const env = appEnv()

    expect(env).toMatchObject({
      HTTPS_PROXY: proxy.url,
      HTTP_PROXY: proxy.url,
      https_proxy: proxy.url,
      http_proxy: proxy.url,
      SSL_CERT_FILE: proxy.caBundlePath,
      REQUESTS_CA_BUNDLE: proxy.caBundlePath,
      CURL_CA_BUNDLE: proxy.caBundlePath,
      NODE_EXTRA_CA_CERTS: proxy.caCertPath,
    })
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it("leaves out of NO_PROXY a bracketed address with a port, which httpx cannot parse", () => {
    const port = new URL(proxy.url).port

    expect(appEnv().NO_PROXY?.split(",")).toEqual([`127.0.0.1:${port}`, `localhost:${port}`])
  })

  it("keeps the app's own NO_PROXY, in both cases", () => {
    const env = proxy.env({ no_proxy: "db.internal" })

    expect(env.NO_PROXY?.split(",")[0]).toBe("db.internal")
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it("bundles danwo's CA first, then the public roots, so a host past the proxy still verifies", async () => {
    const bundle = await readFile(proxy.caBundlePath, "utf8")

    expect(bundle.startsWith(proxy.caCert.trim())).toBe(true)
    expect(bundle.match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(rootCertificates.length + 1)
    expect(caBundle("ca\n", ["one", "two\n"])).toBe("ca\none\ntwo\n")
  })
})

describe.runIf(curl)("curl with the proxy's environment", () => {
  it("reaches a routed host over HTTPS, trusting danwo's CA", async () => {
    const { stdout } = await run("curl", ["-sS", `https://${ROUTED}/curl`], { env: appEnv() })

    expect(stdout).toBe("hello from /curl")
  })
})

describe.runIf(python)("Python's urllib with the proxy's environment", () => {
  it("reaches a routed host over HTTPS, trusting danwo's CA", async () => {
    const { stdout } = await run("python3", ["-c", URLLIB, `https://${ROUTED}/urllib`], {
      env: appEnv(),
    })

    expect(stdout.trim()).toBe("200 hello from /urllib")
  })

  it("is refused a host no route answers under unmatched: block", async () => {
    const { stdout } = await run("python3", ["-c", URLLIB, `https://${UNROUTED}/`], {
      env: appEnv(),
    })

    expect(stdout).toMatch(/^502 danwo proxy: host is not routed/)
  })
})
