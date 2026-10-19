import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import type { ReactNode } from "react"

import { SITE } from "../lib/site.ts"

import appCss from "../styles/app.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { name: "theme-color", content: "#0a0a0a" },
      { title: SITE.name },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/svg+xml", href: "/brand/svg/favicon.svg" },
      { rel: "apple-touch-icon", href: "/brand/png/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
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
