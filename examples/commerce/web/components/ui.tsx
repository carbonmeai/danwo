/** The handful of small pieces every page is built from: badges, alerts, empty states, headings. */
import type { ReactNode } from "react"

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger"

const TONES: Record<Tone, string> = {
  neutral: "bg-subtle text-muted",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
}

export function Badge({
  tone = "neutral",
  children,
}: {
  readonly tone?: Tone
  readonly children: ReactNode
}) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** A message the page leads with: an error as an alert, anything else as a status. */
export function Notice({
  tone,
  children,
}: {
  readonly tone: "ok" | "danger"
  readonly children: ReactNode
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-[13px] ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"}`}
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
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {children && <div className="text-[13px] text-muted">{children}</div>}
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  )
}
