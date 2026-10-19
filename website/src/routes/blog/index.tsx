import { createFileRoute, Link } from "@tanstack/react-router"
import { HomeLayout } from "fumadocs-ui/layouts/home"

import { baseOptions } from "../../lib/layout.tsx"
import { pageHead } from "../../lib/meta.ts"
import { formatDate, newestFirst, postSlug } from "../../lib/posts.ts"
import { blog } from "../../lib/source.ts"

export const Route = createFileRoute("/blog/")({
  head: () =>
    pageHead({
      title: "Blog",
      description: "Notes from building danwo: testing what happens behind the app.",
      path: "/blog",
    }),
  component: BlogIndex,
})

function BlogIndex() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Blog</h1>
        <p className="mt-2 text-fd-muted-foreground">
          Notes from building danwo: testing what happens behind the app.
        </p>
        <ul className="mt-10 flex flex-col gap-3">
          {newestFirst(blog.entries).map((post) => (
            <li key={postSlug(post)}>
              <Link
                to="/blog/$slug"
                params={{ slug: postSlug(post) }}
                className="block rounded-xl bg-fd-card p-5 transition-colors hover:bg-fd-accent"
              >
                <p className="font-mono text-xs text-fd-muted-foreground">
                  {formatDate(post.date)}
                </p>
                <h2 className="mt-1 text-lg font-medium">{post.title}</h2>
                {post.description && (
                  <p className="mt-1 text-sm text-fd-muted-foreground">{post.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </HomeLayout>
  )
}
