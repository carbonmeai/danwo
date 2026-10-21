/** The document every page renders in, inside Clerk's provider. */
import { ClerkProvider } from "@clerk/tanstack-react-start"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"

import styles from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Relay" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: Root,
  errorComponent: ({ error }) => (
    <Document>
      <main className="mx-auto max-w-md px-6 py-24">
        <div role="alert" className="toast toast-error shadow-none">
          <p className="toast-title">Something went wrong</p>
          <p className="toast-text">{error instanceof Error ? error.message : String(error)}</p>
        </div>
        <a className="btn btn-secondary mt-4" href="/">
          Back to Relay
        </a>
      </main>
    </Document>
  ),
})

function Document({ children }: { readonly children: ReactNode }) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/">
      <html lang="en">
        <head>
          <HeadContent />
        </head>
        <body>
          {children}
          <Scripts />
        </body>
      </html>
    </ClerkProvider>
  )
}

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  )
}
