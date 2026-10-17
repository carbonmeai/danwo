import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

/** A local HTML server on a free port. */
export interface HtmlServer {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string
  close(): Promise<void>
}

const NOT_FOUND = "<!doctype html><title>Not found</title><h1>Not found</h1>"

/** Serves the page `pageFor` returns for each request URL, or a 404 page when it returns none. */
export async function serveHtml(pageFor: (url: URL) => string | undefined): Promise<HtmlServer> {
  const server = createServer((req, res) => {
    const html = pageFor(new URL(req.url ?? "/", "http://site"))

    res.writeHead(html === undefined ? 404 : 200, { "content-type": "text/html" })
    res.end(html ?? NOT_FOUND)
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.close()
      await once(server, "close")
    },
  }
}
