import { createFileRoute } from "@tanstack/react-router"
import { HomeLayout } from "fumadocs-ui/layouts/home"

import { useMdxComponents } from "../components/mdx.tsx"
import { baseOptions } from "../lib/layout.tsx"
import { pageHead } from "../lib/meta.ts"
import { formatDate, newestFirst, postSlug } from "../lib/posts.ts"
import { changelog } from "../lib/source.ts"

export const Route = createFileRoute("/changelog")({
  head: () =>
    pageHead({
      title: "Changelog",
      description: "What changed in each danwo release.",
      path: "/changelog",
    }),
  component: Changelog,
})

function Changelog() {
  const components = useMdxComponents()

  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Changelog</h1>
        <p className="mt-2 text-fd-muted-foreground">What changed in each danwo release.</p>
        <div className="mt-12 flex flex-col gap-16">
          {newestFirst(changelog.entries).map((entry) => {
            const Body = entry.body

            return (
              <section
                key={postSlug(entry)}
                id={postSlug(entry)}
                className="grid gap-4 md:grid-cols-[160px_1fr]"
              >
                <p className="font-mono text-xs text-fd-muted-foreground md:pt-2">
                  {formatDate(entry.date)}
                </p>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">{entry.title}</h2>
                  <article className="prose mt-4">
                    <Body components={components} />
                  </article>
                </div>
              </section>
            )
          })}
        </div>
      </main>
    </HomeLayout>
  )
}
