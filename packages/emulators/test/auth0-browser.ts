/**
 * A tiny browser for Auth0 emulator tests: it keeps the tenant's cookies, and fills and posts the
 * Universal Login forms the way a person would.
 */
export type Fetcher = (request: Request) => Promise<Response>

export class LoginBrowser {
  private readonly cookies = new Map<string, string>()
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher
  }

  /** Sends a request with the cookies for its host, and keeps any it sets. */
  async send(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url)
    const headers = new Headers(init.headers)
    const cookie = this.cookies.get(target.host)

    if (cookie !== undefined) headers.set("cookie", cookie)

    const response = await this.fetcher(
      new Request(target, { ...init, headers, redirect: "manual" }),
    )
    const set = response.headers.get("set-cookie")

    if (set !== null) {
      const pair = set.split(";")[0] ?? ""

      if (/=;?$/.test(pair) || set.includes("Max-Age=0")) this.cookies.delete(target.host)
      else this.cookies.set(target.host, pair)
    }

    return response
  }

  /** Opens a URL and follows redirects on `host` (the tenant), stopping at the first one off it. */
  async open(url: string | URL, init: RequestInit = {}): Promise<Response> {
    let response = await this.send(url, init)
    let at = new URL(url)

    while (response.status === 302) {
      const next = new URL(response.headers.get("location") ?? "", at)

      if (next.host !== at.host) return response

      at = next
      response = await this.send(next)
    }

    return response
  }

  /** Posts a form to a page on the same host, with the login state carried along. */
  async post(url: string | URL, fields: Record<string, string>): Promise<Response> {
    return this.send(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    })
  }
}

/** Where a 302 points. */
export function locationOf(response: Response): URL {
  return new URL(response.headers.get("location") ?? "")
}
