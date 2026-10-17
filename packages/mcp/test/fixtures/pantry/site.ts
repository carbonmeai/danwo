/**
 * A two-page grocery app for the MCP server's tests: a pantry page with a button that adds an
 * item, and the basket page it leads to. The pantry page shows a secret from the config, so tests
 * can check it never reaches the agent.
 */
import { once } from "node:events"
import { createServer, type ServerResponse } from "node:http"

import { listeningPort, type WorkerEnvironment } from "@danwo/sdk"

export const PANTRY_SECRET = "pantry-key-0f9a8b7c6d5e"

const PAGES: Readonly<Record<string, string>> = {
  "/": `<!doctype html><title>Pantry</title>
    <h1>Pantry</h1>
    <p>Signed with ${PANTRY_SECRET}</p>
    <ul><li>Oats</li><li>Honey</li></ul>
    <a href="/basket">Add oats to basket</a>
    <button type="button">Clear</button>`,
  "/basket": `<!doctype html><title>Basket</title><h1>Basket</h1><p>1 item: Oats</p>`,
  "/unlock": `<!doctype html><title>Unlock</title><h1>Unlock the pantry</h1>
    <form method="post" action="/unlocked">
      <label>Pantry key <input type="password" name="key"></label>
      <button type="submit">Unlock</button>
    </form>`,
  "/unlocked": `<!doctype html><title>Unlocked</title><h1>Pantry unlocked</h1>`,
}

function answer(res: ServerResponse, path: string): void {
  const page = PAGES[path]

  res.writeHead(page === undefined ? 404 : 200, { "content-type": "text/html" })
  res.end(page ?? "<!doctype html><title>Missing</title><h1>Not here</h1>")
}

export async function pantryEnvironment(): Promise<WorkerEnvironment> {
  const server = createServer((req, res) =>
    answer(res, new URL(req.url ?? "/", "http://x").pathname),
  )

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    baseUrl: `http://127.0.0.1:${listeningPort(server)}`,
    close: async () => {
      server.close()
    },
  }
}
