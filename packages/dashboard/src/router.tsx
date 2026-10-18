import { createRouter } from "@tanstack/react-router"

import { routeTree } from "./routeTree.gen"

/** TanStack Start looks for `getRouter` on the router entry. */
export const getRouter = () =>
  createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
