/**
 * Where the page is and what it copied: `app.url()` and `expect(screen).toHaveURL(…)`, which waits
 * for a navigation, and `app.clipboard()`, which reads what a copy button put on the clipboard
 * once the config grants the clipboard's permissions.
 */
import { once } from "node:events"
import { createServer, type Server } from "node:http"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { checkBrowserConfig } from "../src/browser/context-options.ts"
import { openWebSession } from "../src/session.ts"

/** A page that moves to `/orders?tab=items` a moment after its link is clicked, and copies text. */
const PAGE = `<!doctype html><title>Shop</title>
<a href="#" id="go">Orders</a>
<button onclick="navigator.clipboard.writeText('npx @danwo/cli init')">Copy</button>
<script>
  document.getElementById("go").addEventListener("click", (event) => {
    event.preventDefault()
    setTimeout(() => history.pushState({}, "", "/orders?tab=items"), 300)
  })
</script>`

let server: Server
let url: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(PAGE)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()

  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`
})

afterAll(() => {
  server.close()
})

describe("the page's address", () => {
  it("is read by app.url(), and toHaveURL waits for it as a path, a full URL or a RegExp", async () => {
    const session = await openWebSession({ baseUrl: url })

    try {
      await session.app.open("/")
      expect(session.app.url()).toBe(`${url}/`)

      await session.screen.getByRole("link", { name: "Orders" }).click()
      await session.expect(session.screen).toHaveURL("/orders?tab=items")
      await session.expect(session.screen).toHaveURL(`${url}/orders?tab=items`)
      await session.expect(session.screen).toHaveURL(/\/orders\?tab=items$/)
      await session.expect(session.screen).not.toHaveURL("/")
      expect(session.app.url()).toBe(`${url}/orders?tab=items`)
    } finally {
      await session.close()
    }
  })

  it("fails with what it expected and the address it saw", async () => {
    const session = await openWebSession({ baseUrl: url })

    try {
      await session.app.open("/")
      await expect(
        session.expect(session.screen).toHaveURL("/orders", { timeout: 300 }),
      ).rejects.toMatchObject({
        code: "EXPECTATION_FAILED",
        message: expect.stringContaining(`expected: "${url}/orders"\n  received: "${url}/"`),
      })
      await expect(
        session.expect(session.screen).not.toHaveURL(/127\.0\.0\.1/, { timeout: 300 }),
      ).rejects.toThrow("expected: not /127\\.0\\.0\\.1/")
    } finally {
      await session.close()
    }
  })
})

describe("the clipboard", () => {
  it("reads what the page copied once the config grants the clipboard's permissions", async () => {
    const session = await openWebSession({
      baseUrl: url,
      contextOptions: { permissions: ["clipboard-read", "clipboard-write"] },
    })

    try {
      await session.app.open("/")
      await session.screen.getByRole("button", { name: "Copy" }).click()
      expect(await session.app.clipboard()).toBe("npx @danwo/cli init")
    } finally {
      await session.close()
    }
  })

  it("says which permissions to grant when the page may not read it", async () => {
    const session = await openWebSession({ baseUrl: url })

    try {
      await session.app.open("/")
      await expect(session.app.clipboard()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
        message: expect.stringContaining('permissions: ["clipboard-read", "clipboard-write"]'),
      })
    } finally {
      await session.close()
    }
  })

  it("is granted by name, and a misspelt permission fails the config", () => {
    expect(checkBrowserConfig({ contextOptions: { permissions: ["clipboard-read"] } })).toEqual({
      contextOptions: { permissions: ["clipboard-read"] },
    })
    expect(() =>
      checkBrowserConfig({ contextOptions: { permissions: ["clipbaord-read"] } }),
    ).toThrow(/`browser.contextOptions.permissions.0`: not a browser permission/)
  })
})
