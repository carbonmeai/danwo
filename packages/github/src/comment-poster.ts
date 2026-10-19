/**
 * Posts a run's section of the pull request comment: finds danwo's comment by its marker, merges
 * the section in and edits it, or creates the comment the first time. Runs in one process post
 * one after another, so a `danwo test` and a `danwo matrix` in the same job never race. A refusal
 * is said once and turns the comment off; the check run carries on.
 */
import type { MatrixRunReport, TestRunReport } from "@danwo/runner/runner"

import type { ActionsJob } from "./actions.ts"
import { type CommentsClient, commentsClient } from "./comments.ts"
import {
  COMMENT_MARKER,
  commentBody,
  type CommentLinks,
  matrixSection,
  type NewSection,
  testSection,
} from "./pr-comment.ts"
import { explainRefusal } from "./request.ts"

/** Why a comment request failed, worded as what to do about it. */
const explain = (error: unknown) =>
  explainRefusal(error, "pull request comment", "pull-requests: write")

/** danwo's comment on one pull request. */
class CommentPoster {
  private disabled = false
  private queue: Promise<void> = Promise.resolve()
  private readonly client: CommentsClient
  private readonly number: number
  private readonly log: (line: string) => void

  constructor(client: CommentsClient, number: number, log: (line: string) => void) {
    this.client = client
    this.number = number
    this.log = log
  }

  /** Puts `section` into the comment, after any post already under way. */
  post(section: NewSection): Promise<void> {
    this.queue = this.queue.then(() => this.write(section))

    return this.queue
  }

  private async write(section: NewSection): Promise<void> {
    if (this.disabled) return

    try {
      const existing = await this.client.find(this.number, COMMENT_MARKER)
      const body = commentBody(existing?.body, section)

      if (existing === undefined) await this.client.create(this.number, body)
      else if (existing.body !== body) await this.client.update(existing.id, body)
    } catch (error) {
      this.disabled = true
      this.log(`github: no pull request comment: ${explain(error)}`)
    }
  }
}

/** How the reporter's pull request comment is set up. */
export interface CommentSettings {
  /** Post the comment at all; off with `prComment: false`, `--no-pr-comment` or `DANWO_PR_COMMENT=off`. */
  readonly enabled: boolean
  readonly artifact: string
  readonly reportUrl: string | undefined
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
}

/**
 * The reporter's pull request comment: a section per finished run, on a pull request with a
 * token. A shard of a split run leaves the comment to `danwo merge-reports`, which posts the
 * whole run once.
 */
export class PullRequestComment {
  private poster: CommentPoster | undefined
  private readonly settings: CommentSettings

  constructor(settings: CommentSettings) {
    this.settings = settings
  }

  async tests(job: ActionsJob, run: TestRunReport): Promise<void> {
    const poster = this.posterFor(job)

    if (poster === undefined) return

    if (run.shard !== undefined) {
      this.settings.log(
        `github: shard ${run.shard}: the pull request comment comes from danwo merge-reports`,
      )

      return
    }

    await poster.post(await testSection(run, this.links(job)))
  }

  async matrix(job: ActionsJob, run: MatrixRunReport): Promise<void> {
    await this.posterFor(job)?.post(matrixSection(run, this.links(job)))
  }

  private links(job: ActionsJob): CommentLinks {
    return {
      runUrl: job.runUrl,
      artifact: this.settings.artifact,
      reportUrl: this.settings.reportUrl,
      sha: job.headSha,
    }
  }

  private posterFor(job: ActionsJob): CommentPoster | undefined {
    if (!this.settings.enabled || job.pullRequest === undefined || job.token === undefined)
      return undefined

    this.poster ??= new CommentPoster(
      commentsClient({
        apiUrl: job.apiUrl,
        repository: job.repository,
        token: job.token,
        fetch: this.settings.fetch,
      }),
      job.pullRequest,
      this.settings.log,
    )

    return this.poster
  }
}
