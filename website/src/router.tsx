import { createRouter } from "@tanstack/react-router"

import { NotFound } from "./components/not-found.tsx"
import { routeTree } from "./routeTree.gen"

/** TanStack Start looks for `getRouter` on the router entry. */
export const getRouter = () =>
  createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
