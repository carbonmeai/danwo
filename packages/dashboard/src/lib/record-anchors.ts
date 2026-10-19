/**
 * Addresses inside a flight record: `?step=3` opens the record on its fourth step, `?section=Timeline`
 * scrolls to that section. Picking a step or clicking a section's heading puts it in the address, so
 * a copied link opens the record where it was being read.
 */
import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

/** What a record's address can point at. */
export interface RecordAnchor {
  readonly step?: number
  readonly section?: string
}

/** A step number from the address, when it is one. */
function stepOf(value: unknown): number | undefined {
  const step = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN

  return Number.isInteger(step) && step >= 0 ? step : undefined
}

export function recordAnchor(search: Record<string, unknown>): RecordAnchor {
  const step = stepOf(search.step)
  const { section } = search

  return {
    ...(step !== undefined && { step }),
    ...(typeof section === "string" && section !== "" && { section }),
  }
}

/** The record's step rows, in step order. */
function stepRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[aria-label="Step list"] > [data-row]')]
}

/** Opens the anchored step and section once the record is on screen, and follows picked steps. */
export function useRecordAnchors(anchor: RecordAnchor): void {
  const navigate = useNavigate()

  useEffect(() => {
    const row = anchor.step === undefined ? undefined : stepRows()[anchor.step]

    row?.querySelector("button")?.click()

    const section =
      anchor.section === undefined
        ? undefined
        : document.querySelector(`section[aria-label="${CSS.escape(anchor.section)}"]`)

    // The section, when there is one, is what the address scrolls to; else the step.
    const target = section ?? row

    target?.scrollIntoView({ block: section ? "start" : "center" })
  }, [anchor.step, anchor.section])

  useEffect(() => {
    /** The section whose heading was clicked, by its name. */
    function sectionOf(target: Element): string | undefined {
      return (
        target.closest("h2")?.closest("section[aria-label]")?.getAttribute("aria-label") ??
        undefined
      )
    }

    /** What a click picked: a step, or a section by its heading. */
    function pickedBy(target: Element): RecordAnchor | undefined {
      const row = target.closest("[data-row]")
      const step = row instanceof HTMLElement ? stepRows().indexOf(row) : -1
      const section = sectionOf(target)

      if (step >= 0) return { step }

      return section === undefined ? undefined : { section }
    }

    function onClick(event: MouseEvent) {
      const picked = event.target instanceof Element ? pickedBy(event.target) : undefined

      if (picked !== undefined)
        void navigate({ to: ".", search: (prev) => ({ ...prev, ...picked }), replace: true })
    }

    document.addEventListener("click", onClick)

    return () => document.removeEventListener("click", onClick)
  }, [navigate])
}
