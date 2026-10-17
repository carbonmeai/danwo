/*
 * `getByDisplayValue`: Playwright has no locator for a field's current value, so danwo registers a
 * small selector engine that reads `.value` (not the attribute) of inputs, textareas and selects.
 */
import { selectors } from "playwright-core"

/** The selector engine's name, as used in `danwo-value={...}`. */
const ENGINE = "danwo-value"

/** What the in-page engine compares a field's value with. */
interface Wanted {
  readonly text?: string
  readonly source?: string
  readonly flags?: string
}

/** Runs in the page; must not reach anything outside its own body. */
function valueEngine() {
  const holds = (element: Element, wanted: Wanted): boolean => {
    if (
      !(element instanceof HTMLInputElement) &&
      !(element instanceof HTMLTextAreaElement) &&
      !(element instanceof HTMLSelectElement)
    )
      return false

    return wanted.source === undefined
      ? element.value === wanted.text
      : new RegExp(wanted.source, wanted.flags).test(element.value)
  }

  const queryAll = (root: Element, body: string): Element[] => {
    const wanted = JSON.parse(body) as Wanted

    return [...root.querySelectorAll("input, textarea, select")].filter((el) => holds(el, wanted))
  }

  return { queryAll, query: (root: Element, body: string) => queryAll(root, body)[0] ?? null }
}

/** The one registration of this process. */
let registered: Promise<void> | undefined

/** Registers the engine once per process; it must happen before the browser context is created. */
export function registerValueEngine(): Promise<void> {
  registered ??= selectors.register(ENGINE, valueEngine)

  return registered
}

/** The selector that finds fields whose current value is `value`. */
export function valueSelector(value: string | RegExp): string {
  const wanted: Wanted =
    typeof value === "string" ? { text: value } : { source: value.source, flags: value.flags }

  return `${ENGINE}=${JSON.stringify(wanted)}`
}
