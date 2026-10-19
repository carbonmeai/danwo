import { ThemeProvider } from "@danwo/ui/primitives/theme"
import { Toaster } from "@danwo/ui/primitives/toast/toaster"
import { Span } from "@danwo/ui/primitives/typography"
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { Empty } from "../components/empty-state.tsx"
import { Page } from "../components/page.tsx"
import { ICON_LINKS } from "../modules/layout/brand.ts"
import { AppShell } from "../modules/layout/components/app-shell.tsx"
import { fetchProject } from "../modules/layout/project-api.ts"
import type { Pane } from "../modules/overlay/overlay-panes.tsx"
import { isPane } from "../modules/overlay/record-overlay.tsx"

import appCss from "../styles.css?url"

/**
 * What any page's address can hold on top of its own: a recording open over it (`open`, a record
 * folder), the overlay's pane, and the moment its player starts at (`t`, in seconds).
 */
interface OverlaySearch {
  readonly open?: string
  readonly pane?: Pane
  readonly t?: number
}

function overlaySearch(search: Record<string, unknown>): OverlaySearch {
  const t = Number(search.t)

  return {
    ...(typeof search.open === "string" && search.open !== "" && { open: search.open }),
    ...(isPane(search.pane) && search.pane !== "replay" && { pane: search.pane }),
    ...(search.t !== undefined && Number.isFinite(t) && t >= 0 && { t }),
  }
}

export const Route = createRootRoute({
  validateSearch: overlaySearch,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "danwo" },
    ],
    links: [{ rel: "stylesheet", href: appCss }, ...ICON_LINKS],
  }),
  loader: () => fetchProject(),
  staleTime: Infinity,
  component: RootComponent,
  notFoundComponent: () => (
    <Page crumbs={["Not found"]} title="Not found">
      <Empty title="Nothing at this address" hint={<Link to="/">Back to the tests</Link>} />
    </Page>
  ),
})

function RootComponent() {
  const project = Route.useLoaderData()

  /** Marks the page once React has hydrated it, so a script driving the page knows clicks land. */
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => setHydrated(true), [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AppShell project={project.name}>
            <Outlet />
          </AppShell>
          <Toaster position="bottom-right" />
        </ThemeProvider>
        {hydrated ? <Span data-testid="dashboard-ready" srOnly /> : null}
        <Scripts />
      </body>
    </html>
  )
}
