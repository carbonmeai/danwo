/**
 * Who sent a request through the proxy, read from its user agent: a browser or a server-side
 * client, and, for a test that opens more than one person's browser, which person. Each extra
 * person's browser context sends the run's user tag at the end of its user agent, so their calls
 * and sockets are told apart without a header the app could see in a CORS check.
 */

/** What a person's browser adds to its user agent: ` danwo-user/<name>`. */
export const USER_AGENT_TAG = "danwo-user/"

const TAGGED = /\bdanwo-user\/([\w.-]+)/

function agentOf(userAgent: string | string[] | undefined): string {
  return Array.isArray(userAgent) ? userAgent.join(" ") : (userAgent ?? "")
}

/** Whether a request's user agent is a browser's rather than a server-side HTTP client's. */
export function clientOf(userAgent: string | string[] | undefined): "browser" | "server" {
  return agentOf(userAgent).includes("Mozilla/") ? "browser" : "server"
}

/** The person a request's browser belongs to, when the test opened that browser for someone. */
export function userOf(userAgent: string | string[] | undefined): string | undefined {
  return TAGGED.exec(agentOf(userAgent))?.[1]
}

/** `{ user }` for a record of a request from a person's browser, else nothing. */
export function userField(userAgent: string | string[] | undefined): { readonly user?: string } {
  const user = userOf(userAgent)

  return user === undefined ? {} : { user }
}

/** `userAgent` with `user`'s tag added, for a browser context opened for that person. */
export function taggedUserAgent(userAgent: string, user: string): string {
  return `${userAgent} ${USER_AGENT_TAG}${user}`
}
