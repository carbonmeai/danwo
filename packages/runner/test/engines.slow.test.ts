/**
 * What a session does in each engine danwo launches: the agent acting on its view of the page,
 * locators, an upload and a dialog, a provider call over HTTPS and a WebSocket through danwo's
 * proxy, video with the pointer drawn and secret text shown as dots, a popup becoming the active
 * tab, the page's clock moved forward, and a screenshot compared with a baseline. The app answers
 * on a hostname the proxy routes, so every request goes through the proxy in every engine. An
 * engine whose build danwo's Playwright has not installed is skipped.
 */
import { createHash } from "node:crypto"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Duplex } from "node:stream"

import { createEmulator, type Emulator, stripe } from "@danwo/emulators"
import { type Proxy, startProxy } from "@danwo/proxy"
import type { BrowserContext } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { type BrowserName, browserInstalled } from "../src/browser/index.ts"
import { openWebSession, type WebSession, type WebSessionOptions } from "../src/session.ts"
import { ref, scripted } from "./fixtures/scripted.ts"

const PAGE = `<!doctype html>
<title>Probe</title>
<h1>Probe</h1>
<label>Password <input type="password" id="pw"></label>
<label>Avatar <input type="file" id="avatar"></label>
<p id="file">no file</p>
<button type="button" id="pay">Pay</button>
<p role="status" id="paid">unpaid</p>
<p id="socket">socket: connecting</p>
<p id="today"></p>
<a href="/help" target="_blank">Open help</a>
<button type="button" onclick="alert('careful'); document.getElementById('warned').textContent = 'warned'">Warn</button>
<p id="warned"></p>
<script>
  document.getElementById("today").textContent = "year " + new Date().getUTCFullYear()
  document.getElementById("avatar").addEventListener("change", (event) => {
    document.getElementById("file").textContent = "file " + event.target.files[0].name
  })
  document.getElementById("pay").addEventListener("click", async () => {
    const answer = await fetch("https://api.stripe.com/v1/products", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test_probe", "Content-Type": "application/x-www-form-urlencoded" },
      body: "name=Probe",
    })
    document.getElementById("paid").textContent = "paid " + answer.status
  })
  const socket = new WebSocket("ws://" + location.host + "/live")
  socket.onmessage = (event) => (document.getElementById("socket").textContent = "socket: " + event.data)
  socket.onerror = () => (document.getElementById("socket").textContent = "socket: error")
</script>`

/** Answers a WebSocket handshake and sends one text frame, `live`. */
function answerSocket(key: string, socket: Duplex): void {
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64")
  const text = Buffer.from("live")

  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]))
}

let app: Server
let emulator: Emulator
let proxy: Proxy
let dir: string

beforeAll(async () => {
  app = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(req.url === "/help" ? "<!doctype html><title>Help</title><h1>Help</h1>" : PAGE)
  })
  app.on("upgrade", (req, socket) => answerSocket(String(req.headers["sec-websocket-key"]), socket))
  app.listen(0, "127.0.0.1")
  await once(app, "listening")

  const address = app.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  emulator = createEmulator(stripe, { baseUrl: "https://checkout.stripe.com" })
  proxy = await startProxy({
    routes: [
      { hosts: ["probe.danwo.test"], upstream: `http://127.0.0.1:${port}` },
      { hosts: ["api.stripe.com"], handler: emulator.fetch },
    ],
    unmatched: "block",
  })
  dir = await mkdtemp(join(tmpdir(), "danwo-engines-"))
  await writeFile(join(dir, "avatar.png"), "not really a picture")
})

afterAll(async () => {
  await proxy.stop()
  await emulator.close()
  app.closeAllConnections()
  app.close()
  await rm(dir, { recursive: true, force: true })
})

/** A session in `engine` behind the proxy; `context` is handed its browser context. */
async function probe(
  engine: BrowserName,
  options: Partial<WebSessionOptions> = {},
): Promise<{ session: WebSession; context: () => BrowserContext }> {
  let opened: BrowserContext | undefined
  const session = await openWebSession({
    baseUrl: "http://probe.danwo.test",
    engine,
    proxy: { url: proxy.url, caSpki: proxy.caSpki },
    projectRoot: dir,
    assertionTimeout: 10_000,
    onContext: async (context) => {
      opened ??= context
    },
    ...options,
  })

  return {
    session,
    context: () => {
      if (opened === undefined) throw new Error("the session opened no context")

      return opened
    },
  }
}

const installed = Object.fromEntries(
  await Promise.all(
    (["chromium", "firefox", "webkit"] as const).map(
      async (engine) => [engine, (await browserInstalled(engine)).ok] as const,
    ),
  ),
)

for (const engine of ["chromium", "firefox", "webkit"] as const) {
  describe.skipIf(installed[engine] !== true)(`a session in ${engine}`, () => {
    it("acts on the agent's view of the page", async () => {
      const model = scripted([(view) => ["click", { ref: ref(view, "button", "Pay") }]])
      const { session } = await probe(engine, { model })

      try {
        await session.app.open("/")
        await session.agent.act("pay")
        await session.expect(session.screen.getByRole("status")).toHaveText("paid 200")
      } finally {
        await session.close()
      }

      expect(model.views[0]).toContain('button "Pay"')
    })

    it("uses locators, uploads a file and lets a dialog pass", async () => {
      const { session } = await probe(engine, { files: { avatar: "avatar.png" } })

      try {
        await session.app.open("/")
        await session.screen.getByLabel("Avatar").setInputFiles("avatar")
        await session.expect(session.screen.getByText("file avatar.png")).toBeVisible()
        await session.screen.getByRole("button", { name: "Warn" }).click()
        await session.expect(session.screen.getByText("warned")).toBeVisible()
      } finally {
        await session.close()
      }

      expect(session.flight.steps().map((step) => step.api)).toContain("locator.setInputFiles")
    })

    it("calls a provider over HTTPS and opens a WebSocket, both through the proxy", async () => {
      const { session } = await probe(engine)
      const before = { calls: proxy.exchanges().length, sockets: proxy.sockets().length }

      try {
        await session.app.open("/")
        await session.expect(session.screen.getByText("socket: live")).toBeVisible()
        await session.screen.getByRole("button", { name: "Pay" }).click()
        await session.expect(session.screen.getByRole("status")).toHaveText("paid 200")
      } finally {
        await session.close()
      }

      await proxy.settled()

      const calls = proxy.exchanges().slice(before.calls)

      expect(calls.map((call) => `${call.method} ${call.host}${call.path}`)).toContain(
        "POST api.stripe.com/v1/products",
      )
      expect(calls.some((call) => call.host === "probe.danwo.test")).toBe(true)
      expect(proxy.sockets().slice(before.sockets)).toMatchObject([
        { host: "probe.danwo.test", path: "/live", status: 101 },
      ])
    })

    it("films each tab with the pointer, shows secret text as dots, and follows a popup", async () => {
      const artifactsDir = join(dir, `film-${engine}`)
      const { session, context } = await probe(engine, {
        artifactsDir,
        record: { stepScreenshots: true, video: true, cursor: true },
        secrets: { password: { value: "hunter2", purpose: "password" } },
      })
      let dots = ""
      let pointer = 0

      try {
        await session.app.open("/")
        await session.screen.getByLabel("Password").fill(session.secret("password"))

        const [page] = context().pages()

        dots = String(
          await page?.evaluate(() => {
            const field = document.getElementById("pw")

            return field ? getComputedStyle(field).getPropertyValue("-webkit-text-security") : ""
          }),
        )
        pointer = (await page?.locator("#danwo-pointer").count()) ?? 0
        await session.screen.getByRole("link", { name: "Open help" }).click()
        await session.expect(session.screen.getByRole("heading", { name: "Help" })).toBeVisible()
      } finally {
        await session.close()
      }

      expect(dots).toBe("disc")
      expect(pointer).toBe(1)
      expect(session.flight.videos?.().map((video) => video.file)).toEqual([
        "video/tab-1.webm",
        "video/tab-2.webm",
      ])
      expect(existsSync(join(artifactsDir, "video", "tab-2.webm"))).toBe(true)
    })

    it("moves the page's clock forward and compares a screenshot with its baseline", async () => {
      const baselines = join(dir, `baselines-${engine}`)

      for (const update of ["missing", "none"] as const) {
        const { session } = await probe(engine, { screenshots: { dir: baselines, update } })

        try {
          await session.time.set("2031-06-01T12:00:00Z")
          await session.app.open("/")
          await session.expect(session.screen.getByText("year 2031")).toBeVisible()
          await session
            .expect(session.screen.getByRole("heading", { name: "Probe" }))
            .toHaveScreenshot("heading")
        } finally {
          await session.close()
        }
      }

      expect(existsSync(join(baselines, "heading.png"))).toBe(true)
    })
  })
}
