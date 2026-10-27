import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import type { ReactNode } from "react"

import { i18nUI, langOf } from "../lib/i18n.ts"
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

/** Whether `pathname` is a docs page, which the language switch moves between languages. */
function isDocs(pathname: string): boolean {
  return /^(\/zh-CN)?\/docs(\/|$)/.test(pathname)
}

/**
 * The page every route renders inside: theme, search and the head. A docs page carries its
 * language, for the language switch, the search and the docs' own words.
 */
function Document({ children }: { readonly children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const lang = langOf(pathname)

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <RootProvider
          search={{ options: { type: "static", api: "/api/search" } }}
          {...(isDocs(pathname) && { i18n: i18nUI.provider(lang) })}
        >
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
