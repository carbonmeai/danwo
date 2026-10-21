/**
 * The web app's server functions: each one is a typed call the pages make, run on the server,
 * where it forwards the person's session to Relay's API.
 */
import { auth } from "@clerk/tanstack-react-start/server"
import { createServerFn } from "@tanstack/react-start"

import { read, write } from "./api"
import type { Billing, CalendarEvent, Invite, Note, Session, Workspace } from "./types"

type Id = { readonly id: string }

const id = (data: Id) => data

/** Who is signed in, with their workspaces and pending invitations; null when no one is. */
export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const { isAuthenticated } = await auth()

  return isAuthenticated ? read<Session>("/me") : null
})

/** What the browser needs to open the live-updates socket. */
export const getRealtimeConfig = createServerFn({ method: "GET" }).handler(() => ({
  key: process.env.PUSHER_KEY ?? "",
  cluster: process.env.PUSHER_CLUSTER ?? "",
}))

export const getWorkspace = createServerFn({ method: "GET" })
  .validator(id)
  .handler(({ data }) => read<Workspace>(`/workspaces/${data.id}`))

export const createWorkspace = createServerFn({ method: "POST" })
  .validator(
    (data: { readonly yourName: string; readonly name: string; readonly onboardingKey: string }) =>
      data,
  )
  .handler(({ data }) => write<{ readonly id: string }>("/workspaces", data))

export const listNotes = createServerFn({ method: "GET" })
  .validator(id)
  .handler(({ data }) => read<{ readonly notes: readonly Note[] }>(`/workspaces/${data.id}/notes`))

export const writeNote = createServerFn({ method: "POST" })
  .validator(
    (
      data: Id & {
        readonly title: string
        readonly body: string
        readonly publish: boolean
        readonly requestKey: string
      },
    ) => data,
  )
  .handler(({ data: { id: workspace, ...note } }) =>
    write<{ readonly note: Note }>(`/workspaces/${workspace}/notes`, note),
  )

export const publishNote = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly noteId: number }) => data)
  .handler(({ data }) =>
    write<{ readonly note: Note }>(`/workspaces/${data.id}/notes/${data.noteId}/publish`),
  )

export const scheduleReview = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly noteId: number }) => data)
  .handler(({ data }) =>
    write<{ readonly event: CalendarEvent }>(`/workspaces/${data.id}/notes/${data.noteId}/review`),
  )

export const inviteMember = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly email: string }) => data)
  .handler(({ data }) =>
    write<{ readonly invited: string }>(`/workspaces/${data.id}/invites`, { email: data.email }),
  )

export const getInvite = createServerFn({ method: "GET" })
  .validator((data: { readonly token: string }) => data)
  .handler(({ data }) => read<Invite>(`/invites/${encodeURIComponent(data.token)}`))

export const acceptInvite = createServerFn({ method: "POST" })
  .validator((data: { readonly token: string }) => data)
  .handler(({ data }) =>
    write<{ readonly workspaceId: string }>(`/invites/${encodeURIComponent(data.token)}/accept`),
  )

export const getBilling = createServerFn({ method: "GET" })
  .validator(id)
  .handler(({ data }) => read<Billing>(`/workspaces/${data.id}/billing`))

export const changePlan = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly plan: string }) => data)
  .handler(({ data }) =>
    write<{ readonly plan: string }>(`/workspaces/${data.id}/billing/plan`, { plan: data.plan }),
  )

export const startAddingCard = createServerFn({ method: "POST" })
  .validator(id)
  .handler(({ data }) => write<{ readonly url: string }>(`/workspaces/${data.id}/billing/card`))

export const finishAddingCard = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly sessionId: string }) => data)
  .handler(({ data }) =>
    write<{ readonly workspaceId: string }>(`/workspaces/${data.id}/billing/card/done`, {
      sessionId: data.sessionId,
    }),
  )

export const openBillingPortal = createServerFn({ method: "POST" })
  .validator(id)
  .handler(({ data }) => write<{ readonly url: string }>(`/workspaces/${data.id}/billing/portal`))

type Provider = "slack" | "google"

export const startConnecting = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly provider: Provider }) => data)
  .handler(({ data }) =>
    write<{ readonly url: string }>(`/workspaces/${data.id}/integrations/${data.provider}/start`),
  )

export const finishConnecting = createServerFn({ method: "POST" })
  .validator(
    (data: { readonly provider: Provider; readonly code: string; readonly state: string }) => data,
  )
  .handler(({ data: { provider, ...callback } }) =>
    write<{ readonly workspaceId: string }>(`/integrations/${provider}/callback`, callback),
  )

export const disconnect = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly provider: Provider }) => data)
  .handler(({ data }) =>
    write<{ readonly removed: string }>(
      `/workspaces/${data.id}/integrations/${data.provider}`,
      {},
      "DELETE",
    ),
  )

export const listSlackChannels = createServerFn({ method: "GET" })
  .validator(id)
  .handler(({ data }) =>
    write<{
      readonly channels: readonly { readonly id: string; readonly name: string }[]
      readonly selected: string | null
    }>(`/workspaces/${data.id}/integrations/slack/channels`, undefined, "GET"),
  )

export const chooseSlackChannel = createServerFn({ method: "POST" })
  .validator((data: Id & { readonly channelId: string }) => data)
  .handler(({ data }) =>
    write<{ readonly channel: string }>(`/workspaces/${data.id}/integrations/slack/channel`, {
      channelId: data.channelId,
    }),
  )

export const listCalendarEvents = createServerFn({ method: "GET" })
  .validator(id)
  .handler(({ data }) =>
    write<{ readonly events: readonly CalendarEvent[] }>(
      `/workspaces/${data.id}/integrations/google/events`,
      undefined,
      "GET",
    ),
  )
