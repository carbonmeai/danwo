/**
 * Checking and unchecking a checkbox or radio, including the styled ones component libraries
 * draw: the real `<input>` sits invisible behind a `<span>` inside its own `<label>`, so a click
 * on the input lands on the span and Playwright waits until it times out. When the input's own
 * label covers it, danwo clicks the label instead, as a user would, and then checks the state.
 */
import type { Locator } from "playwright-core"

/** How `setChecked` acts: its timeout, and `force` to skip every actionability check. */
export interface CheckOptions {
  readonly timeout: number
  readonly force?: boolean | undefined
}

/**
 * Whether `node` is a checkbox or radio input whose centre is covered by another element inside
 * one of its own labels. Runs in the page; it scrolls the input into view first when it is out of
 * it, as the click would.
 */
function coveredByOwnLabel(node: Element): boolean {
  const toggle = node instanceof HTMLInputElement && /^(checkbox|radio)$/.test(node.type)
  const labels = toggle ? [...(node.labels ?? [])] : []

  if (labels.length === 0) return false

  node.scrollIntoView({ block: "nearest", inline: "nearest" })

  const box = node.getBoundingClientRect()
  const root = node.getRootNode()
  const surface = root instanceof ShadowRoot ? root : document
  const hit = surface.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)

  return hit !== null && hit !== node && labels.some((label) => label.contains(hit))
}

/** The first label of the input `node`. Runs in the page. */
function firstLabel(node: Element): HTMLLabelElement | null {
  return node instanceof HTMLInputElement ? (node.labels?.[0] ?? null) : null
}

/**
 * Sets `element` checked or unchecked. An input covered by its own label is set by clicking the
 * label, and the result is read back: it fails when the click did not leave the input as asked.
 */
export async function setChecked(
  element: Locator,
  checked: boolean,
  options: CheckOptions,
): Promise<void> {
  const { timeout } = options

  if (options.force === true) return element.setChecked(checked, { timeout, force: true })

  if (!(await element.evaluate(coveredByOwnLabel, undefined, { timeout })))
    return element.setChecked(checked, { timeout })

  if ((await element.isChecked({ timeout })) === checked) return

  const label = await element.evaluateHandle(firstLabel, undefined, { timeout })

  try {
    const target = label.asElement()

    if (target === null) return await element.setChecked(checked, { timeout })

    await target.click({ timeout })
  } finally {
    await label.dispose()
  }

  if ((await element.isChecked({ timeout })) !== checked)
    throw new Error(
      `clicking its label did not ${checked ? "check" : "uncheck"} it (a radio cannot be unchecked)`,
    )
}
