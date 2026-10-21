import { createFileRoute, redirect } from "@tanstack/react-router"

import { RunsSkeleton } from "../modules/runs/runs-skeleton.tsx"

/**
 * A flight record's old address. A recording now opens over the runs list, so this sends the
 * browser there with it open, keeping the moment (`t`) it pointed at; `#step-N` rides along.
 */
export const Route = createFileRoute("/records/$")({
  loader: ({ params, location }) => {
    const t = Number((location.search as Record<string, unknown>).t)

    throw redirect({
      to: "/runs",
      search: { open: params._splat ?? "", ...(Number.isFinite(t) && t >= 0 && { t }) },
    })
  },
  /** Where the address sends the browser, in case the redirect is slow to land. */
  pendingComponent: () => <RunsSkeleton />,
})
