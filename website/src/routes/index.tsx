import { createFileRoute } from "@tanstack/react-router"
import { useRef } from "react"

import { Closing } from "../landing/closing.tsx"
import { CodeSection } from "../landing/code.tsx"
import { Compare } from "../landing/compare.tsx"
import { Features } from "../landing/features.tsx"
import { Footer } from "../landing/footer.tsx"
import { Hero } from "../landing/hero.tsx"
import { HowItWorks } from "../landing/how.tsx"
import { Logos } from "../landing/logos.tsx"
import { Nav } from "../landing/nav.tsx"
import { Plans } from "../landing/plans.tsx"
import { pageHead } from "../lib/meta.ts"
import { SITE } from "../lib/site.ts"

/** The repository's star count from GitHub, when the repository is public and GitHub answers. */
async function starCount(): Promise<number | undefined> {
  if (SITE.repo === undefined) return undefined

  try {
    const response = await fetch(`https://api.github.com/repos/${SITE.repo}`)
    const body: unknown = response.ok ? await response.json() : undefined

    if (typeof body === "object" && body !== null && "stargazers_count" in body)
      return typeof body.stargazers_count === "number" ? body.stargazers_count : undefined
  } catch {
    return undefined
  }

  return undefined
}

export const Route = createFileRoute("/")({
  loader: async () => ({ stars: await starCount() }),
  staleTime: Infinity,
  head: () =>
    pageHead({ title: `${SITE.name}: ${SITE.tagline}`, description: SITE.description, path: "/" }),
  component: Landing,
})

function Landing() {
  const { stars } = Route.useLoaderData()
  const hero = useRef<HTMLElement>(null)

  return (
    <div className="landing">
      <Nav hero={hero} stars={stars} />
      <Hero ref={hero} />
      <main>
        <Logos />
        <HowItWorks />
        <Features />
        <CodeSection />
        <Compare />
        <Plans />
      </main>
      <Closing />
      <Footer />
    </div>
  )
}
