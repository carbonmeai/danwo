import { createRouter } from "@tanstack/react-router"

import { PageSkeleton } from "./modules/layout/components/page-skeleton.tsx"
import { routeTree } from "./routeTree.gen"

/** TanStack Start looks for `getRouter` on the router entry. */
export const getRouter = () =>
  createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    /**
     * Each page brings a skeleton shaped like it; this one is for any page that has none. A page
     * that loads within 150 ms never shows its skeleton, and one that shows it keeps it at least
     * 300 ms, so a load that lands just after never flashes it.
     */
    defaultPendingComponent: PageSkeleton,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
