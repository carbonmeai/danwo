import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import type { ReactNode } from "react"

import { BRAND_ICON } from "../components/brand.tsx"
import { SITE } from "../lib/site.ts"

import appCss from "../styles/app.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { name: "theme-color", content: "#0a0a0b" },
      { title: SITE.name },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: BRAND_ICON },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <Document>
      <Outlet />
    </Document>
  )
}

/** The page every route renders inside: theme, search and the head. */
function Document({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <RootProvider search={{ options: { type: "static", api: "/api/search" } }}>
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
