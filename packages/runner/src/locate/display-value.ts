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
  const engine = {
    queryAll(root: Element, body: string): Element[] {
      const parsed: unknown = JSON.parse(body)

      const field = (name: keyof Wanted): string | undefined => {
        const found: unknown =
          typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, name) : undefined

        return typeof found === "string" ? found : undefined
      }

      const text = field("text")
      const source = field("source")
      const pattern = source === undefined ? undefined : new RegExp(source, field("flags"))

      return [...root.querySelectorAll("input, textarea, select")].filter((element) => {
        if (
          !(element instanceof HTMLInputElement) &&
          !(element instanceof HTMLTextAreaElement) &&
          !(element instanceof HTMLSelectElement)
        )
          return false

        return pattern ? pattern.test(element.value) : element.value === text
      })
    },
    query: (root: Element, body: string): Element | null => engine.queryAll(root, body)[0] ?? null,
  }

  return engine
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
