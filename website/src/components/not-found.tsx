import { Link } from "@tanstack/react-router"
import { HomeLayout } from "fumadocs-ui/layouts/home"

import { baseOptions } from "../lib/layout.tsx"

/** The page for an address the site has nothing at. */
export function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
        <p className="font-mono text-sm text-fd-muted-foreground">404</p>
        <h1 className="text-3xl font-semibold tracking-tight">Nothing at this address</h1>
        <p className="max-w-md text-fd-muted-foreground">
          The page may have moved. The docs are the best place to look.
        </p>
        <div className="mt-2 flex gap-2">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
          >
            Read the docs
          </Link>
          <Link to="/" className="rounded-lg bg-fd-muted px-4 py-2 text-sm font-medium">
            Home
          </Link>
        </div>
      </main>
    </HomeLayout>
  )
}
