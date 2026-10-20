/**
 * The server a sign-in's redirect lands on: it listens on the redirect URI's own host, port and
 * path on this machine, answers the browser once, and hands the query to the login.
 */
import { createServer, type Server } from "node:http"

/** A problem the person signing in can fix, reported without a stack. */
export class LoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LoginError"
  }
}

/** What the browser brought back to the redirect URI. */
export interface Redirect {
  readonly params: URLSearchParams
}

/** The addresses to listen on for a loopback host: `localhost` may resolve to either family. */
function addressesOf(uri: URL): readonly string[] {
  const host = uri.hostname.replace(/^\[|\]$/g, "")

  if (uri.protocol !== "http:")
    throw new LoginError(
      `${uri.href} is not served over plain http on this machine; danwo can only listen on http://localhost or http://127.0.0.1 redirect URIs`,
    )
  if (host === "localhost") return ["127.0.0.1", "::1"]
  if (host === "127.0.0.1" || host === "::1") return [host]

  throw new LoginError(
    `${uri.href} points at ${host}, not this machine; register a http://localhost or http://127.0.0.1 redirect URI on the client`,
  )
}

function portOf(uri: URL): number {
  return uri.port === "" ? 80 : Number(uri.port)
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>danwo</title>
<body style="font:16px system-ui;margin:48px">Signed in. You can close this tab and go back to the terminal.</body>`

/** Starts listening on one address; a busy port is the person's to free, another family's absence is not. */
function listenOn(server: Server, address: string, uri: URL): Promise<"listening" | "unavailable"> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE")
        reject(
          new LoginError(
            `port ${portOf(uri)} on ${uri.hostname} is in use: stop the app on :${portOf(uri)} first (its dev server, most likely), then run the sign-in again`,
          ),
        )
      else if (address === "::1") resolve("unavailable")
      else reject(error)
    })
    server.listen(portOf(uri), address, () => resolve("listening"))
  })
}

/**
 * Listens for the browser coming back to `uri`; `redirect` settles with its query the first time
 * it does. Other paths are answered 404 and ignored.
 */
export async function listenForRedirect(
  uri: URL,
): Promise<{ redirect: Promise<Redirect>; close(): Promise<void> }> {
  const { promise: redirect, resolve: deliver } = Promise.withResolvers<Redirect>()
  const servers: Server[] = []
  const close = () =>
    Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((done) => {
            server.close(() => done())
            /* A browser keeps its connection open; closing it lets the server stop now. */
            server.closeAllConnections()
          }),
      ),
    ).then(() => {})

  try {
    for (const address of addressesOf(uri)) {
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", uri)

        if (url.pathname !== uri.pathname) {
          response.writeHead(404).end()

          return
        }

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(DONE_PAGE)
        deliver({ params: url.searchParams })
      })

      if ((await listenOn(server, address, uri)) === "listening") servers.push(server)
    }
  } catch (error) {
    await close()
    throw error
  }

  return { redirect, close }
}
