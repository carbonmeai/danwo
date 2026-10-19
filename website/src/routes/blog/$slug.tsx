import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { HomeLayout } from "fumadocs-ui/layouts/home"

import { useMdxComponents } from "../../components/mdx.tsx"
import { baseOptions } from "../../lib/layout.tsx"
import { pageHead } from "../../lib/meta.ts"
import { formatDate, postSlug } from "../../lib/posts.ts"
import { blog } from "../../lib/source.ts"

/** The post whose file is named `slug`. */
function findPost(slug: string) {
  return blog.entries.find((post) => postSlug(post) === slug)
}

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = findPost(params.slug)

    if (!post) throw notFound()

    return { slug: params.slug, title: post.title, description: post.description ?? "" }
  },
  head: ({ loaderData }) =>
    loaderData
      ? pageHead({
          title: loaderData.title,
          description: loaderData.description,
          path: `/blog/${loaderData.slug}`,
          type: "article",
        })
      : {},
  component: BlogPost,
})

function BlogPost() {
  const { slug } = Route.useLoaderData()
  const post = findPost(slug)

  if (!post) return null

  const Body = post.body

  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-3xl px-4 py-16">
        <Link to="/blog" className="text-sm text-fd-muted-foreground hover:text-fd-foreground">
          ← Blog
        </Link>
        <p className="mt-8 font-mono text-xs text-fd-muted-foreground">
          {formatDate(post.date)}
          {post.author && ` · ${post.author}`}
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{post.title}</h1>
        {post.description && (
          <p className="mt-3 text-lg text-fd-muted-foreground">{post.description}</p>
        )}
        <article className="prose mt-10">
          <Body components={useMdxComponents()} />
        </article>
      </main>
    </HomeLayout>
  )
}
