/**
 * Billing: the subscription, the plans to switch between, the card (added on Stripe's own page),
 * the billing portal, and the invoices. Coming back from Stripe's page, it saves the new card at
 * once rather than waiting for the webhook; whichever lands first, the other changes nothing.
 */
import { createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"

import { Badge, dollars, Notice, shortDate, statusLabel } from "../components/ui"
import {
  changePlan,
  finishAddingCard,
  getBilling,
  openBillingPortal,
  startAddingCard,
} from "../lib/server"
import type { Billing, Plan } from "../lib/types"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/settings/billing")({
  validateSearch: z.object({ setup: z.string().optional() }),
  loader: ({ params }) => getBilling({ data: { id: params.workspaceId } }),
  component: BillingPage,
})

/** When the subscription next changes: the trial's end, or the next renewal. */
function timing(billing: Billing): string {
  if (billing.status === "trialing" && billing.trialEndsAt)
    return `Trial ends ${shortDate(billing.trialEndsAt)}`
  if (billing.status === "past_due") return "Payment failed: update the card to keep the workspace"
  if (billing.currentPeriodEnd) return `Renews ${shortDate(billing.currentPeriodEnd)}`

  return ""
}

function PlanCard({
  plan,
  current,
  admin,
  onChoose,
  busy,
}: {
  readonly plan: Plan
  readonly current: Plan | undefined
  readonly admin: boolean
  readonly onChoose: (plan: Plan) => void
  readonly busy: boolean
}) {
  const mine = plan.key === current?.key
  const verb = current && plan.priceCents > current.priceCents ? "Upgrade to" : "Switch to"

  return (
    <article
      className={`card flex flex-col ${mine ? "border-[var(--kit-fg)]" : ""}`}
      aria-label={`${plan.name} plan`}
    >
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="card-title">{plan.name}</h3>
          {mine && <Badge tone="info">Current plan</Badge>}
        </div>
        <p className="text-2xl font-semibold">
          {dollars(plan.priceCents)}
          <span className="text-sm font-normal text-muted"> / month</span>
        </p>
        <p className="card-description">{plan.blurb}</p>
      </div>
      <ul className="card-body flex flex-1 flex-col gap-1 text-sm">
        {plan.features.map((feature) => (
          <li key={feature}>✓ {feature}</li>
        ))}
      </ul>
      {admin && !mine && (
        <div className="card-footer">
          <button
            className="btn btn-secondary w-full"
            onClick={() => onChoose(plan)}
            disabled={busy}
          >
            {verb} {plan.name}
          </button>
        </div>
      )}
    </article>
  )
}

function BillingPage() {
  const { current } = workspaceRoute.useLoaderData()
  const billing = Route.useLoaderData()
  const { setup } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string }>()
  const finished = useRef<string | undefined>(undefined)
  const workspaceId = current.workspace.id
  const admin = current.role === "org:admin"
  const plan = billing.plans.find((one) => one.key === billing.plan)

  /* Back from Stripe's page with a card: save it now, then drop the session id from the address. */
  useEffect(() => {
    if (!setup || finished.current === setup) return

    finished.current = setup
    void finishAddingCard({ data: { id: workspaceId, sessionId: setup } }).then(async (done) => {
      setMessage(
        done.ok
          ? { tone: "success", text: "Your card is saved." }
          : { tone: "danger", text: done.error },
      )
      await navigate({ to: ".", search: {}, replace: true })
      await router.invalidate()
    })
  }, [setup, workspaceId, navigate, router])

  async function go(start: typeof startAddingCard | typeof openBillingPortal) {
    setBusy(true)

    const opened = await start({ data: { id: workspaceId } })

    if (opened.ok) return window.location.assign(opened.data.url)

    setBusy(false)
    setMessage({ tone: "danger", text: opened.error })
  }

  async function choose(next: Plan) {
    setBusy(true)
    setMessage(undefined)

    const changed = await changePlan({ data: { id: workspaceId, plan: next.key } })

    setBusy(false)
    setMessage(
      changed.ok
        ? { tone: "success", text: `You're on the ${next.name} plan.` }
        : { tone: "danger", text: changed.error },
    )
    await router.invalidate()
  }

  return (
    <div className="stack">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <section className="card">
        <div className="card-body grid gap-4 md:grid-cols-3">
          <div className="stat">
            <p className="stat-label">Plan</p>
            <p className="stat-value" data-testid="billing-plan">
              {plan?.name ?? billing.plan}
            </p>
          </div>
          <div className="stat">
            <p className="stat-label">Status</p>
            <p className="stat-value">
              <Badge
                tone={
                  billing.status === "past_due"
                    ? "danger"
                    : billing.status === "active"
                      ? "success"
                      : "info"
                }
              >
                <span data-testid="billing-status">{statusLabel(billing.status)}</span>
              </Badge>
            </p>
            <p className="text-xs text-muted">{timing(billing)}</p>
          </div>
          <div className="stat">
            <p className="stat-label">Card</p>
            <p className="stat-value text-base" data-testid="billing-card">
              {billing.card ?? "No card yet"}
            </p>
          </div>
        </div>
        {admin && (
          <div className="card-footer flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => go(startAddingCard)} disabled={busy}>
              {billing.card ? "Update the card" : "Add a card"}
            </button>
            <button className="btn btn-ghost" onClick={() => go(openBillingPortal)} disabled={busy}>
              Manage billing
            </button>
          </div>
        )}
      </section>

      <section aria-label="Plans" className="grid gap-4 md:grid-cols-3">
        {billing.plans.map((one) => (
          <PlanCard
            key={one.key}
            plan={one}
            current={plan}
            admin={admin}
            onChoose={choose}
            busy={busy}
          />
        ))}
      </section>

      <section className="stack" aria-labelledby="invoices">
        <h2 id="invoices" className="text-base font-semibold">
          Invoices
        </h2>
        {billing.invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Invoices">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{shortDate(invoice.created * 1000)}</td>
                    <td>
                      {invoice.url ? (
                        <a href={invoice.url} className="underline">
                          {invoice.number ?? invoice.id}
                        </a>
                      ) : (
                        (invoice.number ?? invoice.id)
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={
                          invoice.status === "paid"
                            ? "success"
                            : invoice.status === "open"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {invoice.status ?? "draft"}
                      </Badge>
                    </td>
                    <td className="num">{dollars(invoice.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
