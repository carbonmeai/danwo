import { once } from "node:events"
import { createServer, type IncomingMessage, type Server } from "node:http"

import { listeningPort } from "@danwo/emulators"

/** A local HTML server on a free port. */
export interface HtmlServer {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string
  close(): Promise<void>
}

const NOT_FOUND = "<!doctype html><title>Not found</title><h1>Not found</h1>"

/** A response other than a page: its status, body and content type. */
export interface Answer {
  readonly status: number
  readonly body: string
  readonly type?: string
}

/**
 * Serves what `pageFor` returns for each request URL: a page, another answer, or a 404 page when
 * it returns nothing.
 */
export async function serveHtml(
  pageFor: (url: URL) => string | Answer | undefined,
): Promise<HtmlServer> {
  const server = createServer((req, res) => {
    const found = pageFor(new URL(req.url ?? "/", "http://site"))
    const answer: Answer =
      typeof found === "string"
        ? { status: 200, body: found }
        : (found ?? { status: 404, body: NOT_FOUND })

    res.writeHead(answer.status, { "content-type": answer.type ?? "text/html" })
    res.end(answer.body)
  })

  return listen(server)
}

/** Serves the page `pageFor` resolves to for each request; a request it throws on gets a 500. */
export async function serveForms(
  pageFor: (req: IncomingMessage) => Promise<string>,
): Promise<HtmlServer> {
  const server = createServer((req, res) => {
    pageFor(req).then(
      (html) => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end(html)
      },
      () => {
        res.writeHead(500)
        res.end()
      },
    )
  })

  return listen(server)
}

async function listen(server: Server): Promise<HtmlServer> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${listeningPort(server)}`,
    close: async () => {
      server.close()
      await once(server, "close")
    },
  }
}
