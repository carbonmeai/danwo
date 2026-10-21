/** Small pieces every page uses: the top bar, a status badge, and polling the API. */
import { type ReactNode, useEffect, useState } from "react"

import { badgeOf } from "./format.ts"
import { Link } from "./router.tsx"

/** The bar over a page: where it is, and the page's own action. */
export function Topbar({
  trail,
  action,
}: {
  readonly trail: readonly { readonly label: string; readonly to?: string }[]
  readonly action?: ReactNode
}) {
  return (
    <header className="shell-topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <span>Northwind</span>
        {trail.map((step, n) =>
          step.to && n < trail.length - 1 ? (
            <Link key={step.label} to={step.to}>
              {step.label}
            </Link>
          ) : (
            <span key={step.label} aria-current={n === trail.length - 1 ? "page" : undefined}>
              {step.label}
            </span>
          ),
        )}
      </nav>
      {action}
    </header>
  )
}

/** A status as a coloured badge. */
export function Status({ of }: { readonly of: string | null }) {
  const [className, label] = badgeOf(of)

  return <span className={className}>{label}</span>
}

/** What a load came to: the value, the error that stopped it, or nothing yet. */
export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed"; readonly error: string }

/**
 * Loads `load()` now and again every `everyMs` while `keepGoing` says so, so a page shows the
 * background jobs' progress without a reload. `version` loads again at once when it changes.
 */
export function usePolled<T>(
  load: () => Promise<T>,
  {
    everyMs,
    keepGoing,
    version,
  }: {
    readonly everyMs: number
    readonly keepGoing: (value: T) => boolean
    readonly version: unknown
  },
): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" })

  useEffect(() => {
    let stopped = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const value = await load()

        if (stopped) return
        setLoaded({ state: "ready", value })
        if (keepGoing(value)) timer = window.setTimeout(() => void tick(), everyMs)
      } catch (error) {
        if (stopped) return
        setLoaded({
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
        timer = window.setTimeout(() => void tick(), everyMs)
      }
    }

    void tick()

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
    /* `load` and `keepGoing` are fresh closures each render; `version` says when to start over. */
  }, [version, everyMs])

  return loaded
}
