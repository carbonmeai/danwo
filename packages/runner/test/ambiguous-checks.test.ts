/**
 * A check whose locator keeps matching several elements fails as `LOCATOR_AMBIGUOUS`, a test
 * issue, as an action on that locator does, and says how to narrow it; not as the app showing
 * something unexpected.
 */
import { once } from "node:events"
import { createServer, type Server } from "node:http"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession, type WebSession } from "../src/session.ts"
import { classOf, codeOf } from "../src/support/codes.ts"

const PAGE = `<!doctype html><title>Two saves</title><button>Save</button><button>Save</button>`

let server: Server
let session: WebSession

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(PAGE)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  session = await openWebSession({ baseUrl: `http://127.0.0.1:${port}` })
}, 60_000)

afterAll(async () => {
  await session?.close()
  server?.close()
})

describe("a check on a locator that matches several elements", () => {
  it("fails as LOCATOR_AMBIGUOUS, a test issue, and says how to narrow it", async () => {
    const { app, screen, expect: check } = session

    await app.open("/")

    const failed = await check(screen.getByRole("button", { name: "Save" }))
      .toBeVisible({ timeout: 300 })
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    expect(codeOf(failed)).toBe("LOCATOR_AMBIGUOUS")
    expect(classOf(codeOf(failed))).toBe("test")
    expect(String(failed)).toMatch(/matched 2 elements; it needs exactly one \(use first\(\)/)
  })

  it("still passes once narrowed to one", async () => {
    const { app, screen, expect: check } = session

    await app.open("/")
    await expect(
      check(screen.getByRole("button", { name: "Save" }).first()).toBeVisible(),
    ).resolves.toBeUndefined()
  })
})
