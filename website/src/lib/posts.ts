/** Blog posts and changelog entries: their addresses and their order. */

/** What every post has: where its file is and when it was published. */
interface Post {
  readonly info: { readonly path: string }
  readonly date: Date
}

/** A post's slug: its file name without the extension. */
export function postSlug(post: Post): string {
  return post.info.path.replace(/\.mdx?$/, "")
}

/**
 * Posts newest first. Posts of one day go by their slug, highest first, its numbers read as
 * numbers: two releases on one day list `0.1.1` above `0.1.0`, and `0.1.10` above `0.1.9`.
 */
export function newestFirst<T extends Post>(posts: readonly T[]): T[] {
  return posts.toSorted(
    (a, b) =>
      b.date.getTime() - a.date.getTime() ||
      postSlug(b).localeCompare(postSlug(a), "en", { numeric: true }),
  )
}

/** A date as the site prints it, such as "19 October 2026". */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}
