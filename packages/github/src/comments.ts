/**
 * The slice of GitHub's issue comments API a pull request comment needs: find danwo's comment on
 * the pull request by its marker, create it, and edit it. A pull request's conversation is its
 * issue's, so the issues endpoints serve both.
 */
import { type ClientOptions, repositorySender } from "./request.ts"

/** A comment already on the pull request. */
export interface PostedComment {
  readonly id: number
  readonly body: string
}

export interface CommentsClient {
  /** The oldest comment on pull request `number` whose body holds `marker`. */
  find(number: number, marker: string): Promise<PostedComment | undefined>
  create(number: number, body: string): Promise<void>
  update(id: number, body: string): Promise<void>
}

/** GitHub's largest page of comments. */
const PER_PAGE = 100
/** Pages read before giving up on finding the comment: a thousand comments. */
const MAX_PAGES = 10

/** The comments in a page of GitHub's answer, as ids and bodies. */
function commentsIn(page: unknown): PostedComment[] {
  if (!Array.isArray(page)) return []

  return page.flatMap((item: unknown): PostedComment[] => {
    if (typeof item !== "object" || item === null) return []

    const id = "id" in item ? item.id : undefined
    const body = "body" in item ? item.body : undefined

    return typeof id === "number" && typeof body === "string" ? [{ id, body }] : []
  })
}

/** A comments client for one repository. */
export function commentsClient(options: ClientOptions): CommentsClient {
  const send = repositorySender(options)

  return {
    async find(number, marker) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const comments = commentsIn(
          await send("GET", `/issues/${number}/comments?per_page=${PER_PAGE}&page=${page}`),
        )
        const found = comments.find((comment) => comment.body.includes(marker))

        if (found !== undefined || comments.length < PER_PAGE) return found
      }

      return undefined
    },
    async create(number, body) {
      await send("POST", `/issues/${number}/comments`, { body })
    },
    async update(id, body) {
      await send("PATCH", `/issues/comments/${id}`, { body })
    },
  }
}
