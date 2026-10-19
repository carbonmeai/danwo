/**
 * Requests to GitHub's REST API for one repository, over plain `fetch`, with the headers GitHub
 * asks for and refusals turned into errors that keep their status.
 */

/** A request GitHub refused, with its status so callers can tell a missing permission apart. */
export class GitHubError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "GitHubError"
    this.status = status
  }
}

/**
 * Why a request failed, worded as what to do about it: a 403 or 404 means the workflow's token
 * lacks `permission` for `what`.
 */
export function explainRefusal(error: unknown, what: string, permission: string): string {
  if (error instanceof GitHubError && (error.status === 403 || error.status === 404))
    return `GitHub refused the ${what} (${error.status}: ${error.message}); give the workflow "permissions: ${permission}"`

  return error instanceof Error ? error.message : String(error)
}

/** Where requests go and who sends them. */
export interface ClientOptions {
  readonly apiUrl: string
  readonly repository: string
  readonly token: string
  readonly fetch: typeof fetch
}

/** Sends one request: a method, a path under the repository, and an optional JSON body. */
export type Send = (method: string, path: string, body?: object) => Promise<unknown>

/** The message GitHub sent with a refusal, or its status text. */
async function refusal(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")

  try {
    const body: { message?: unknown } = JSON.parse(text)

    return typeof body.message === "string" ? body.message : response.statusText
  } catch {
    return text || response.statusText
  }
}

/** A sender for paths under `/repos/<repository>`, e.g. `/check-runs`. */
export function repositorySender(options: ClientOptions): Send {
  const base = `${options.apiUrl.replace(/\/$/, "")}/repos/${options.repository}`

  return async (method, path, body) => {
    const response = await options.fetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        "user-agent": "danwo",
        "x-github-api-version": "2022-11-28",
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })

    if (!response.ok) throw new GitHubError(response.status, await refusal(response))

    return response.json()
  }
}
