import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import {
  AUTH0_HOSTS,
  auth0,
  auth0Tenant,
  createEmulator,
  listeningPort,
  seedAuth0,
} from "@danwo/emulators"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { startProxy } from "../src/proxy.ts"

const AUTH0_APP = fileURLToPath(new URL("./fixtures/auth0-app.ts", import.meta.url))
const DOMAIN = "acme.eu.auth0.com"

async function freePort(): Promise<number> {
  const server = createServer()

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const port = listeningPort(server)

  server.close()

  return port
}

/**
 * The person's browser: cookies per host, redirects followed by hand. The tenant's pages are
 * answered by the emulator, the app's by the app itself.
 */
function browser(tenant: (request: Request) => Promise<Response>) {
  const jars = new Map<string, Map<string, string>>()

  async function send(url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url)
    const jar = jars.get(target.host) ?? new Map<string, string>()
    const headers = new Headers(init.headers)

    if (jar.size > 0)
      headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "))

    const request = new Request(target, { ...init, headers, redirect: "manual" })
    const response = await (target.host === DOMAIN ? tenant(request) : fetch(request))

    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";")
      const at = pair.indexOf("=")
      const name = pair.slice(0, at)
      const value = pair.slice(at + 1)

      if (value === "" || /max-age=0|expires=thu, 01 jan 1970/i.test(cookie)) jar.delete(name)
      else jar.set(name, value)
    }

    jars.set(target.host, jar)

    return response
  }

  /** Follows redirects until a page answers. */
  async function open(url: string, init: RequestInit = {}): Promise<Response> {
    let at = url
    let response = await send(at, init)

    while (response.status >= 300 && response.status < 400) {
      at = new URL(response.headers.get("location") ?? "", at).toString()
      response = await send(at)
    }

    return response
  }

  return { open, send }
}

describe("routing an unmodified express-openid-connect app", () => {
  it("logs in on the hosted page, reads the profile with the access token and logs out at the tenant", async () => {
    const port = await freePort()
    const app = `http://127.0.0.1:${port}`
    const emulator = createEmulator(auth0)

    seedAuth0(emulator.store, {
      tenants: [
        {
          domain: DOMAIN,
          post_login_claims: { "https://shop.test/plan": "pro" },
          clients: [
            {
              client_id: "shop-web",
              client_secret: "shop-secret",
              name: "Shop",
              callbacks: [`${app}/callback`],
              allowed_logout_urls: [app, `${app}/`],
            },
          ],
          apis: [{ identifier: "https://api.shop.test", scopes: ["read:orders"] }],
          users: [
            { email: "ada@shop.test", password: "Analytical-1", name: "Ada", email_verified: true },
          ],
        },
      ],
    })

    const proxy = await startProxy({
      routes: [{ hosts: [...AUTH0_HOSTS], handler: emulator.fetch }],
      unmatched: "block",
    })
    const child = spawn(process.execPath, [AUTH0_APP], {
      env: {
        ...proxy.env(),
        PORT: String(port),
        AUTH0_DOMAIN: DOMAIN,
        AUTH0_CLIENT_ID: "shop-web",
        AUTH0_CLIENT_SECRET: "shop-secret",
        AUTH0_AUDIENCE: "https://api.shop.test",
      },
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["ignore", "pipe", "inherit"],
    })
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    const person = browser(emulator.fetch)

    try {
      expect(
        z.object({ port: z.number() }).parse(JSON.parse(String((await lines.next()).value))),
      ).toEqual({ port })

      const login = await person.open(`${app}/login`)
      const page = await login.text()

      expect(page).toContain("Log in to")

      const state = /name="state" value="([^"]+)"/.exec(page)?.[1] ?? ""
      const submitted = await person.send(`https://${DOMAIN}/u/login?state=${state}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ state, username: "ada@shop.test", password: "Analytical-1" }),
      })
      const home = await person.open(new URL(submitted.headers.get("location") ?? "").toString())

      expect(await home.text()).toBe("signed in")

      const me = z
        .object({ email: z.string(), claims: z.record(z.string(), z.unknown()), scope: z.string() })
        .parse(await (await person.open(`${app}/me`)).json())

      expect(me).toMatchObject({
        email: "ada@shop.test",
        claims: { iss: `https://${DOMAIN}/`, aud: "shop-web", "https://shop.test/plan": "pro" },
        scope: "has access token",
      })

      const logout = await person.send(`${app}/logout`)
      const atTenant = new URL(logout.headers.get("location") ?? "")

      expect(atTenant.host).toBe(DOMAIN)

      const back = await person.send(atTenant.toString())

      expect(back.headers.get("location")).toMatch(new RegExp(`^${app}/?$`))
      expect(auth0Tenant(emulator).logins("ada@shop.test")).toHaveLength(1)

      await proxy.settled()
      /* An ID token straight from the token endpoint is trusted over TLS, so no keys are fetched. */
      expect(
        proxy
          .exchanges()
          .map((e) => `${e.disposition} ${e.method} ${e.host}${e.path.split("?")[0]}`),
      ).toEqual([
        `routed GET ${DOMAIN}/.well-known/openid-configuration`,
        `routed POST ${DOMAIN}/oauth/token`,
        `routed GET ${DOMAIN}/userinfo`,
      ])
    } finally {
      child.kill()
      await proxy.stop()
      await emulator.close()
    }
  })
})
