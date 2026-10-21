/** The handful of small pieces every page is built from, on the examples' kit. */
import type { ReactNode } from "react"

type Tone = "neutral" | "success" | "warning" | "danger"

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
  children,
}: {
  readonly tone: "success" | "danger"
  readonly children: ReactNode
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={`toast shadow-none ${tone === "danger" ? "toast-error" : "toast-success"}`}
    >
      {children}
    </p>
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

export function PageTitle({
  title,
  children,
}: {
  readonly title: string
  readonly children?: ReactNode
}) {
  return (
    <div className="page-header flex-row flex-wrap items-end justify-between gap-3">
      <h1 className="page-title text-2xl">{title}</h1>
      {children}
    </div>
  )
}
