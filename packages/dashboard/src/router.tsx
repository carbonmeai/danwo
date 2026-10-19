import { createRouter } from "@tanstack/react-router"

import { PageSkeleton } from "./modules/layout/components/page-skeleton.tsx"
import { routeTree } from "./routeTree.gen"

/** TanStack Start looks for `getRouter` on the router entry. */
export const getRouter = () =>
  createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPendingComponent: PageSkeleton,
    defaultPendingMs: 200,
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
