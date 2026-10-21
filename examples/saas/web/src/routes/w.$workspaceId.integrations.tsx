/**
 * Integrations: a card per service with its connection state and a connect button, which goes
 * through the service's own consent page and comes back here; once connected, what it does.
 */
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"
import { z } from "zod"

import { Shell } from "../components/shell"
import { Badge, Notice, PageHeader, shortDate } from "../components/ui"
import {
  chooseSlackChannel,
  disconnect,
  listCalendarEvents,
  listSlackChannels,
  startConnecting,
} from "../lib/server"
import type { CalendarEvent, Integration } from "../lib/types"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/integrations")({
  validateSearch: z.object({ connected: z.enum(["slack", "google"]).optional() }),
  component: IntegrationsPage,
})

const NAMES = { slack: "Slack", google: "Google Calendar" } as const

function StatusBadge({ connection }: { readonly connection: Integration | undefined }) {
  if (!connection) return <Badge>Not connected</Badge>
  if (connection.status === "needs_attention") return <Badge tone="warning">Needs attention</Badge>

  return <Badge tone="success">Connected</Badge>
}

/** A service's card: what it does, its state, and connect, reconnect or disconnect. */
function IntegrationCard({
  provider,
  description,
  connection,
  admin,
  children,
}: {
  readonly provider: "slack" | "google"
  readonly description: string
  readonly connection: Integration | undefined
  readonly admin: boolean
  readonly children?: ReactNode
}) {
  const { current } = workspaceRoute.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const name = NAMES[provider]

  async function connect() {
    setBusy(true)

    const started = await startConnecting({ data: { id: current.workspace.id, provider } })

    if (started.ok) return window.location.assign(started.data.url)

    setBusy(false)
    setError(started.error)
  }

  async function remove() {
    setBusy(true)
    await disconnect({ data: { id: current.workspace.id, provider } })
    setBusy(false)
    await router.invalidate()
  }

  return (
    <section className="card" aria-label={name}>
      <div className="card-header flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="card-title">{name}</h2>
          <p className="card-description">{description}</p>
        </div>
        <StatusBadge connection={connection} />
      </div>
      <div className="card-body stack">
        {error && <Notice tone="danger">{error}</Notice>}
        {connection && (
          <p className="text-sm text-muted">
            Connected to <strong className="text-fg">{connection.account}</strong>
            {connection.status === "needs_attention" && ". Relay lost access: connect it again."}
          </p>
        )}
        {connection?.status === "connected" && children}
      </div>
      {admin && (
        <div className="card-footer flex gap-2">
          {connection?.status !== "connected" ? (
            <button className="btn btn-primary" onClick={connect} aria-busy={busy} disabled={busy}>
              {connection ? `Reconnect ${name}` : `Connect ${name}`}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={remove} aria-busy={busy} disabled={busy}>
              Disconnect
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** Which channel published notes go to. */
function SlackChannel() {
  const { current } = workspaceRoute.useLoaderData()
  const router = useRouter()
  const [channels, setChannels] =
    useState<readonly { readonly id: string; readonly name: string }[]>()
  const [selected, setSelected] = useState<string>("")
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const admin = current.role === "org:admin"

  useEffect(() => {
    void listSlackChannels({ data: { id: current.workspace.id } }).then((listed) => {
      if (!listed.ok) return setError(listed.error)

      setChannels(listed.data.channels)
      setSelected(listed.data.selected ?? "")
    })
  }, [current.workspace.id])

  async function save() {
    setSaved(false)

    const chosen = await chooseSlackChannel({
      data: { id: current.workspace.id, channelId: selected },
    })

    if (!chosen.ok) return setError(chosen.error)

    setSaved(true)
    await router.invalidate()
  }

  if (error) return <Notice tone="danger">{error}</Notice>
  if (!channels) return <p className="text-sm text-muted">Loading channels…</p>

  return (
    <div className="flex flex-col gap-2">
      <label className="label" htmlFor="slack-channel">
        Post published notes to
      </label>
      <div className="flex gap-2">
        <select
          id="slack-channel"
          className="input max-w-xs"
          value={selected}
          disabled={!admin}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose a channel</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
        {admin && (
          <button className="btn btn-secondary" onClick={save} disabled={!selected}>
            Save channel
          </button>
        )}
      </div>
      {saved && (
        <p role="status" className="text-sm text-muted">
          Published notes now go to the channel.
        </p>
      )}
    </div>
  )
}

/** The calendar's next few events. */
function NextEvents() {
  const { current } = workspaceRoute.useLoaderData()
  const [events, setEvents] = useState<readonly CalendarEvent[]>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void listCalendarEvents({ data: { id: current.workspace.id } }).then((listed) =>
      listed.ok ? setEvents(listed.data.events) : setError(listed.error),
    )
  }, [current.workspace.id])

  if (error) return <Notice tone="danger">{error}</Notice>
  if (!events) return <p className="text-sm text-muted">Loading the calendar…</p>
  if (events.length === 0) return <p className="text-sm text-muted">Nothing coming up.</p>

  return (
    <ul aria-label="Coming up" className="flex flex-col gap-1 text-sm">
      {events.map((event) => (
        <li key={event.id} className="flex justify-between gap-3">
          <span>{event.title}</span>
          <span className="text-muted">{event.start ? shortDate(event.start) : ""}</span>
        </li>
      ))}
    </ul>
  )
}

function IntegrationsPage() {
  const { session, current } = workspaceRoute.useLoaderData()
  const { connected } = Route.useSearch()
  const of = (provider: "slack" | "google") =>
    current.integrations.find((one) => one.provider === provider)
  const admin = current.role === "org:admin"

  return (
    <Shell session={session} current={current} title="Integrations">
      <PageHeader title="Integrations" description="Connect the tools your team already uses." />
      <div className="stack">
        {connected && <Notice tone="success">{NAMES[connected]} is connected.</Notice>}
        <div className="grid gap-4 md:grid-cols-2">
          <IntegrationCard
            provider="slack"
            description="Post every published note to a channel."
            connection={of("slack")}
            admin={admin}
          >
            <SlackChannel />
          </IntegrationCard>
          <IntegrationCard
            provider="google"
            description="See what's coming up, and book a review for a note."
            connection={of("google")}
            admin={admin}
          >
            <NextEvents />
          </IntegrationCard>
        </div>
      </div>
    </Shell>
  )
}
