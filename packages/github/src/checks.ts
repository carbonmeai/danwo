/**
 * The slice of GitHub's Checks REST API a run needs: create a check run, add to its output, and
 * complete it. Requests go over plain `fetch`.
 */

/** A line a check points at, shown inline on the pull request's diff. */
export interface Annotation {
  readonly path: string
  readonly start_line: number
  readonly end_line: number
  readonly annotation_level: "notice" | "warning" | "failure"
  readonly title: string
  readonly message: string
}

/** A check run's output; GitHub keeps every annotation sent across updates. */
export interface CheckOutput {
  readonly title: string
  readonly summary: string
  readonly annotations?: readonly Annotation[]
}

export type Conclusion = "success" | "failure" | "neutral" | "cancelled"

/** GitHub accepts at most this many annotations in one request. */
export const ANNOTATIONS_PER_REQUEST = 50

/** A request GitHub refused, with its status so callers can tell a missing permission apart. */
export class GitHubError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "GitHubError"
    this.status = status
  }
}

export interface ChecksClient {
  create(name: string, headSha: string, detailsUrl: string): Promise<number>
  update(id: number, output: CheckOutput): Promise<void>
  complete(id: number, conclusion: Conclusion, output: CheckOutput): Promise<void>
}

interface ClientOptions {
  readonly apiUrl: string
  readonly repository: string
  readonly token: string
  readonly fetch: typeof fetch
}

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

/** A Checks client for one repository. */
export function checksClient(options: ClientOptions): ChecksClient {
  const base = `${options.apiUrl.replace(/\/$/, "")}/repos/${options.repository}/check-runs`

  const send = async (method: string, url: string, body: object): Promise<unknown> => {
    const response = await options.fetch(url, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        "user-agent": "danwo",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) throw new GitHubError(response.status, await refusal(response))

    return response.json()
  }

  return {
    async create(name, headSha, detailsUrl) {
      const created = await send("POST", base, {
        name,
        head_sha: headSha,
        details_url: detailsUrl,
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
      const id = typeof created === "object" && created !== null && "id" in created && created.id

      if (typeof id !== "number") throw new GitHubError(0, "the created check run has no id")

      return id
    },
    async update(id, output) {
      await send("PATCH", `${base}/${id}`, { output })
    },
    async complete(id, conclusion, output) {
      await send("PATCH", `${base}/${id}`, {
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output,
      })
    },
  }
}
