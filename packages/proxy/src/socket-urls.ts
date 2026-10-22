/**
 * WebKit opens a WebSocket through an HTTP proxy by sending its handshake to the proxy with the
 * socket's own URL, `GET ws://host/path`, where Chromium and Firefox first open a CONNECT tunnel.
 * The interception library reads only `http://` and `https://` request URLs and answers any other
 * with 400, so WebKit's sockets never connected. Each upgrade's `ws://` or `wss://` URL is given
 * its HTTP scheme before the library reads it; the host, port and path stay as the page asked.
 */
import { EventEmitter } from "node:events"
import { IncomingMessage } from "node:http"

/** The URL `url` names with an HTTP scheme, for a `ws://` or `wss://` one; others unchanged. */
export function httpSocketUrl(url: string): string {
  const scheme = /^(wss?):\/\//i.exec(url)?.[1]?.toLowerCase()

  if (scheme === undefined) return url

  return `${scheme === "wss" ? "https" : "http"}://${url.slice(scheme.length + 3)}`
}

/** Whether `value` can be handed back to an emitter as one of its listeners. */
function isListener(value: unknown): value is (...args: unknown[]) => void {
  return typeof value === "function"
}

/**
 * Rewrites the scheme of every upgrade `server` (the library's started proxy) receives, before its
 * own handler runs. The library's server hands each listener on to the HTTP servers inside it in
 * the order they were added, so its own handler is taken off and put back after this one. When a
 * later version keeps its server elsewhere, says so once and leaves it: that version may read
 * WebSocket URLs itself, and a warning is better than a proxy that will not start.
 */
export function acceptSocketUrls(server: object): void {
  const inner: unknown = Reflect.get(server, "server")

  if (!(inner instanceof EventEmitter)) {
    process.emitWarning(
      "danwo: this mockttp version keeps its server elsewhere; WebKit's WebSockets may not get through",
    )

    return
  }

  const theirs = inner.listeners("upgrade").filter(isListener)

  for (const listener of theirs) inner.removeListener("upgrade", listener)
  inner.on("upgrade", (request: unknown) => {
    if (request instanceof IncomingMessage && request.url !== undefined)
      request.url = httpSocketUrl(request.url)
  })
  for (const listener of theirs) inner.on("upgrade", listener)
}
