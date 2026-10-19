import { type RefObject, useDeferredValue, useEffect, useRef, useState } from "react"

/** What a key press means to a list. */
export type ListAction = "focus-filter" | "leave-filter" | "next" | "previous" | "open"

/** The facts about a key press a list decides on. */
export interface KeyPress {
  readonly key: string
  /** Cmd, Ctrl or Alt was held: the browser's shortcut, not the list's. */
  readonly modified: boolean
  /** The press landed in a field the person is typing in. */
  readonly typing: boolean
  /** The press landed in the list's own filter box. */
  readonly inFilter: boolean
  readonly hasFilter: boolean
  /** The focused element already does something on Enter (a link or a button). */
  readonly onControl: boolean
  readonly hasCurrent: boolean
}

/** `/` jumps into the filter and Escape leaves it. */
function filterAction(press: KeyPress): ListAction | undefined {
  if (press.key === "/" && press.hasFilter && !press.typing) return "focus-filter"

  return press.key === "Escape" && press.inFilter ? "leave-filter" : undefined
}

const MOVES: Readonly<Record<string, ListAction>> = { j: "next", k: "previous" }

/** j and k move between rows; Enter opens the current one unless a control has focus. */
function rowAction(press: KeyPress): ListAction | undefined {
  if (press.typing) return undefined

  const move = MOVES[press.key]

  if (move) return move

  return press.key === "Enter" && press.hasCurrent && !press.onControl ? "open" : undefined
}

/** What a key press does to a list, if anything. */
export function listAction(press: KeyPress): ListAction | undefined {
  return press.modified ? undefined : (filterAction(press) ?? rowAction(press))
}

/** True when a key press belongs to a field the person is typing in. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

function pressOf(event: KeyboardEvent, filter: HTMLInputElement | null, current: number): KeyPress {
  return {
    key: event.key,
    modified: event.metaKey || event.ctrlKey || event.altKey,
    typing: typing(event.target),
    inFilter: filter !== null && event.target === filter,
    hasFilter: filter !== null,
    onControl:
      event.target instanceof HTMLAnchorElement || event.target instanceof HTMLButtonElement,
    hasCurrent: current >= 0,
  }
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

    function moveBy(delta: number) {
      const all = rows()

      setCurrent((i) => {
        const next = Math.max(0, Math.min(i + delta, all.length - 1))

        all[next]?.scrollIntoView({ block: "nearest" })

        return next
      })
    }

    const box = () => filter?.current ?? null
    const run: Readonly<Record<ListAction, () => void>> = {
      "focus-filter": () => {
        box()?.focus()
        box()?.select()
      },
      "leave-filter": () => box()?.blur(),
      next: () => moveBy(1),
      previous: () => moveBy(-1),
      open: () => rows()[current]?.querySelector("a")?.click(),
    }

    function onKey(event: KeyboardEvent) {
      const action = listAction(pressOf(event, box(), current))

      if (action === undefined) return

      event.preventDefault()
      run[action]()
    }

    window.addEventListener("keydown", onKey)

    return () => window.removeEventListener("keydown", onKey)
  }, [list, filter, current])

  return current
}

/** True when the text holds every word of the query, ignoring case. */
function wordsMatch(text: string, query: string): boolean {
  const haystack = text.toLowerCase()

  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word))
}

/**
 * A list's filter: what was typed, the rows that match it, and the box `/` jumps to. `kept` is a
 * query to start from and to report each change to, so the page's address can hold it.
 */
export function useFilter<T>(
  rows: readonly T[],
  textOf: (row: T) => string,
  kept?: { readonly query: string; readonly onChange: (query: string) => void },
) {
  const [query, setTyped] = useState(kept?.query ?? "")

  const setQuery = (next: string) => {
    setTyped(next)
    kept?.onChange(next)
  }

  const deferred = useDeferredValue(query.trim())
  const box = useRef<HTMLInputElement>(null)
  const shown = deferred === "" ? rows : rows.filter((row) => wordsMatch(textOf(row), deferred))

  return { query, setQuery, deferred, shown, box }
}
