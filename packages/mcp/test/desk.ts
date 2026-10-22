/**
 * A session's page desk on a small site of the test's own pages, without the MCP server or a
 * session process around it: one browser for the file, a fresh desk per test.
 */
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type ContextOptions, launchBrowser, SecretVault } from "@danwo/runner"
import { createRedactor } from "@danwo/runner/runner"
import type { Browser } from "playwright-core"

import { PageDesk } from "../src/sessions/page.ts"

/** The secret every desk is given, so tests can check it never shows. */
export const DESK_SECRET = "desk-key-5e4d3c2b1a09"

export interface DeskSite {
  /** Opens a desk on `path`; answers with it and its first snapshot. */
  open(
    path: string,
    options?: {
      readonly files?: Readonly<Record<string, string>>
      readonly contextOptions?: ContextOptions
    },
  ): Promise<{ desk: PageDesk; text: string }>
  /** The project folder the desks resolve upload paths against. */
  readonly root: string
  close(): Promise<void>
}

/** Serves `pages` by path and starts one browser for every desk opened on them. */
export async function deskSite(pages: Readonly<Record<string, string>>): Promise<DeskSite> {
  const server: Server = createServer((req, res) => {
    const page = pages[new URL(req.url ?? "/", "http://x").pathname]

    res.writeHead(page === undefined ? 404 : 200, { "content-type": "text/html" })
    res.end(page ?? "<!doctype html><title>Missing</title><h1>Not here</h1>")
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  const browser: Browser = await launchBrowser({ headless: true })
  const root = await mkdtemp(join(tmpdir(), "danwo-desk-"))
  const desks: PageDesk[] = []

  return {
    root,
    async open(path, options = {}) {
      const vault = new SecretVault({ deskKey: DESK_SECRET })
      const redactor = createRedactor(vault.redact)
      const opened = await PageDesk.open(
        {
          browser,
          baseUrl: `http://127.0.0.1:${port}`,
          vault,
          redact: (text) => redactor.text(text),
          root,
          files: options.files ?? {},
          contextOptions: options.contextOptions,
          recordDir: { path: join(root, "recording"), shown: "recording/" },
        },
        path,
      )

      desks.push(opened.desk)

      return opened
    },
    async close() {
      await Promise.all(desks.map((desk) => desk.close()))
      await browser.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
