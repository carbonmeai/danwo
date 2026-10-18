import { type RefObject, useEffect, useState } from "react"

/** True when a key press belongs to a field the person is typing in. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

/**
 * j and k move through a list's rows, Enter opens the current one and `/` jumps to the filter.
 * Rows are the elements under `list` marked `data-row`; opening a row follows its first link.
 * Returns the current row, -1 before the first key press.
 */
export function useListKeys(
  list: RefObject<HTMLElement | null>,
  count: number,
  filter?: RefObject<HTMLInputElement | null>,
): number {
  const [current, setCurrent] = useState(-1)

  useEffect(() => setCurrent((i) => Math.min(i, count - 1)), [count])

  useEffect(() => {
    function rows(): HTMLElement[] {
      return [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])]
    }

    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === "/" && filter?.current && !typing(event.target)) {
        event.preventDefault()
        filter.current.focus()
        filter.current.select()

        return
      }

      if (event.key === "Escape" && event.target === filter?.current) {
        filter.current?.blur()

        return
      }

      if (typing(event.target)) return

      const all = rows()

      if (event.key === "j" || event.key === "k") {
        event.preventDefault()
        setCurrent((i) => {
          const next = event.key === "j" ? Math.min(i + 1, all.length - 1) : Math.max(i - 1, 0)

          all[next]?.scrollIntoView({ block: "nearest" })

          return next
        })
      } else if (
        event.key === "Enter" &&
        current >= 0 &&
        !(event.target instanceof HTMLAnchorElement || event.target instanceof HTMLButtonElement)
      ) {
        all[current]?.querySelector("a")?.click()
      }
    }

    window.addEventListener("keydown", onKey)

    return () => window.removeEventListener("keydown", onKey)
  }, [list, filter, current])

  return current
}
