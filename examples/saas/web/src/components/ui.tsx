/** The small pieces every page is built from, on the examples' kit. */
import type { ReactNode } from "react"

type Tone = "neutral" | "success" | "warning" | "danger" | "info"

export function Badge({
  tone = "neutral",
  children,
}: {
  readonly tone?: Tone
  readonly children: ReactNode
}) {
  return <span className={tone === "neutral" ? "badge" : `badge badge-${tone}`}>{children}</span>
}

/** A message the page leads with: an error as an alert, anything else as a status. */
export function Notice({
  tone,
  title,
  children,
}: {
  readonly tone: "success" | "danger"
  readonly title?: string
  readonly children?: ReactNode
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`toast shadow-none ${tone === "danger" ? "toast-error" : "toast-success"}`}
    >
      {title && <p className="toast-title">{title}</p>}
      {children && <div className="toast-text">{children}</div>}
    </div>
  )
}

export function Empty({
  title,
  children,
}: {
  readonly title: string
  readonly children?: ReactNode
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-text">{children}</div>}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description?: string
  readonly children?: ReactNode
}) {
  return (
    <div className="page-header flex-row flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="page-title text-2xl">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {children}
    </div>
  )
}

/** A usage meter: how much of a plan's allowance is used, as a bar with its numbers. */
export function UsageMeter({
  label,
  used,
  limit,
}: {
  readonly label: string
  readonly used: number
  readonly limit: number
}) {
  const share = Math.min(1, limit === 0 ? 0 : used / limit)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted">
          {used} of {limit.toLocaleString("en-US")}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="h-2 overflow-hidden rounded-full bg-[var(--kit-bg-hover)]"
      >
        <div
          className={`h-full rounded-full ${share > 0.9 ? "bg-[var(--kit-danger)]" : "bg-primary"}`}
          style={{ width: `${Math.max(share * 100, used > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  )
}

/** `$29` for whole dollars, `$9.50` otherwise. */
export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

/** `4 Nov 2026` for a date. */
export function shortDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/** A Stripe subscription status in words. */
export function statusLabel(status: string | null): string {
  const labels: Readonly<Record<string, string>> = {
    trialing: "Trial",
    active: "Active",
    past_due: "Past due",
    canceled: "Canceled",
    incomplete: "Incomplete",
    unpaid: "Unpaid",
  }

  return status ? (labels[status] ?? status) : "Setting up"
}

/** Whole days from now until `value`, rounded up; 0 once it has passed. */
export function daysUntil(value: string): number {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000))
}
