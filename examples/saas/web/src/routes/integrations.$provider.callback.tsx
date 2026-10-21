/**
 * Where Slack's and Google's consent pages send the browser back to. The server hands the code to
 * the API, which trades it for the workspace's tokens, then shows the integrations page.
 */
import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

import { Logo } from "../components/shell"
import { Notice } from "../components/ui"
import { finishConnecting } from "../lib/server"

const Provider = z.enum(["slack", "google"])

export const Route = createFileRoute("/integrations/$provider/callback")({
  validateSearch: z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const provider = Provider.parse(params.provider)

    if (deps.error || !deps.code || !deps.state)
      return {
        provider,
        error:
          deps.error === "access_denied"
            ? "You cancelled connecting."
            : "The connection didn't finish.",
      }

    const done = await finishConnecting({ data: { provider, code: deps.code, state: deps.state } })

    if (done.ok)
      throw redirect({
        to: "/w/$workspaceId/integrations",
        params: { workspaceId: done.data.workspaceId },
        search: { connected: provider },
      })

    return { provider, error: done.error }
  },
  component: CallbackProblem,
})

function CallbackProblem() {
  const { provider, error } = Route.useLoaderData()

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <Logo />
      <Notice tone="danger" title={`${provider === "slack" ? "Slack" : "Google"} isn't connected`}>
        {error}
      </Notice>
      <a className="btn btn-secondary" href="/">
        Back to Relay
      </a>
    </main>
  )
}
