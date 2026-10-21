/** The app's router, made fresh for every request on the server and once in the browser. */
import { createRouter } from "@tanstack/react-router"

import { routeTree } from "./routeTree.gen.ts"

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true, defaultPreload: false })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
