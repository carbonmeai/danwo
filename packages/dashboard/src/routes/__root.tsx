import { ThemeProvider } from "@danwo/ui/primitives/theme"
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router"

import { Empty } from "../components/empty-state.tsx"
import { Page } from "../components/page.tsx"
import { AppShell } from "../modules/layout/components/app-shell.tsx"
import { FAVICON } from "../modules/layout/components/brand.tsx"
import { fetchProject } from "../modules/layout/project-api.ts"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "danwo" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: FAVICON },
    ],
  }),
  loader: () => fetchProject(),
  staleTime: Infinity,
  component: RootComponent,
  notFoundComponent: () => (
    <Page crumbs={["Not found"]} title="Not found">
      <Empty title="Nothing at this address" hint={<Link to="/">Back to the runs</Link>} />
    </Page>
  ),
})

function RootComponent() {
  const project = Route.useLoaderData()

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
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
