/**
 * The page a device's browser shows, as the proxy saw it: neither platform's driver reports the
 * address of a Custom Tab or a Safari view, but every page the browser loads goes through the proxy.
 */
import type { Proxy } from "@danwo/proxy"

/** The newest document the browser fetched through the proxy, as a URL. */
export function browserPage(proxy: Pick<Proxy, "exchanges">): string | undefined {
  const page = proxy
    .exchanges()
    .toReversed()
    .find((exchange) => {
      const headers = exchange.request?.headers ?? {}

      return (
        headers["sec-fetch-dest"] === "document" || (headers.accept ?? "").includes("text/html")
      )
    })

  return page === undefined ? undefined : `https://${page.host}${page.path}`
}
