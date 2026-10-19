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

/** Posts newest first. */
export function newestFirst<T extends Post>(posts: readonly T[]): T[] {
  return posts.toSorted((a, b) => b.date.getTime() - a.date.getTime())
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
