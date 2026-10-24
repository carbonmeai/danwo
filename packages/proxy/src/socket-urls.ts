/**
 * WebKit opens a WebSocket through an HTTP proxy by sending its handshake to the proxy with the
 * socket's own URL, `GET ws://host/path`, where Chromium and Firefox first open a CONNECT tunnel.
 * The proxy reads such a request by its HTTP scheme; the host, port and path stay as the page asked.
 */

/** The URL `url` names with an HTTP scheme, for a `ws://` or `wss://` one; others unchanged. */
export function httpSocketUrl(url: string): string {
  const scheme = /^(wss?):\/\//i.exec(url)?.[1]?.toLowerCase()

  if (scheme === undefined) return url

  return `${scheme === "wss" ? "https" : "http"}://${url.slice(scheme.length + 3)}`
}
