/**
 * Serves the built site over plain HTTP: adapter-node's handler behind Node's own server, as
 * adapter-node's custom-server recipe does. `node build` alone takes every request to be HTTPS
 * unless a proxy in front says otherwise in PROTOCOL_HEADER, and a form posted from an http://
 * page then fails SvelteKit's cross-site check. This server speaks HTTP itself, so it says so.
 *
 * Usage: `node server.ts`, after `vite build`, with PORT and HOST set.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

/* adapter-node reads its environment when its handler loads, so this goes first. */
process.env.PROTOCOL_HEADER = "x-forwarded-proto"

/** The handler `vite build` wrote; imported by a computed path, so a type check needs no build. */
const entry = new URL("build/handler.js", import.meta.url).href
const { handler } = (await import(entry)) as { readonly handler: Handler }

const server = createServer((req, res) => {
  req.headers["x-forwarded-proto"] = "http"
  handler(req, res, () => {
    res.statusCode = 404
    res.end("Not found")
  })
})

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? "127.0.0.1"

server.listen(port, host, () => console.log(`Fern Studio's site on http://${host}:${port}`))

/* Stop taking requests on a stop signal, and finish the ones in flight. */
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close(() => process.exit(0))
    server.closeIdleConnections()
  })
