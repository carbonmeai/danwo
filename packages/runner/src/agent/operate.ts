/** The things the agent does to the page, shared by live steps and replays. */
import type { Locator, Page } from "playwright-core"

import type { OpenDialog, Tabs } from "../browser/tabs.ts"

/** One action on one element. */
export type Operation =
  | { readonly kind: "click" }
  | { readonly kind: "fill"; readonly text: string }
  | { readonly kind: "press"; readonly key: string }
  | { readonly kind: "select"; readonly option: string }
  | { readonly kind: "check"; readonly checked: boolean }
  | { readonly kind: "hover" }
  | { readonly kind: "scroll-into-view" }
  | { readonly kind: "upload"; readonly paths: readonly string[] }
  | { readonly kind: "drag"; readonly to: Locator }

/** Puts `paths` into the file input `element` is, or into the file chooser it opens when clicked. */
async function upload(element: Locator, paths: readonly string[], timeout: number): Promise<void> {
  const isFileInput = await element.evaluate(
    (node) => node instanceof HTMLInputElement && node.type === "file",
    undefined,
    { timeout },
  )

  if (isFileInput) {
    await element.setInputFiles([...paths], { timeout })

    return
  }

  const page = element.page()
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout }),
    element.click({ timeout }),
  ])

  await chooser.setFiles([...paths], { timeout })
}

/** Performs `operation` on `element`, waiting up to `timeout` for it to be ready. */
export async function operate(
  element: Locator,
  operation: Operation,
  timeout: number,
): Promise<void> {
  switch (operation.kind) {
    case "click":
      return element.click({ timeout })
    case "fill":
      return element.fill(operation.text, { timeout })
    case "press":
      return element.press(operation.key, { timeout })
    case "select":
      await element.selectOption(operation.option, { timeout })

      return
    case "check":
      return element.setChecked(operation.checked, { timeout })
    case "hover":
      return element.hover({ timeout })
    case "scroll-into-view":
      return element.scrollIntoViewIfNeeded({ timeout })
    case "upload":
      return upload(element, operation.paths, timeout)
    case "drag":
      return element.dragTo(operation.to, { timeout })
  }
}

/** What happened around an action besides the action itself. */
export interface Aftermath {
  /** A dialog the action opened; it waits for an answer. */
  readonly dialog?: OpenDialog
  /** True when the action opened a new tab, which is now the active one. */
  readonly openedTab: boolean
}

/** How long a click is given to open a tab before the page is looked at again. */
const TAB_GRACE_MS = 250

/**
 * Runs `action` on the active tab with dialogs held, and reports a dialog it opened or a tab it
 * opened. `expectTab` waits (up to `timeout`) for a tab a recording says the action opened.
 */
export async function watched(
  tabs: Tabs,
  action: () => Promise<unknown>,
  options: {
    readonly timeout: number
    readonly expectTab?: boolean
    readonly mayOpenTab?: boolean
  },
): Promise<Aftermath> {
  const before = tabs.list().length
  const opening = tabs.tabOpened()
  const dialog = await tabs.runAction(action)

  if (dialog !== undefined) return { dialog, openedTab: false }

  if (tabs.list().length === before) {
    const wait = options.expectTab ? options.timeout : options.mayOpenTab ? TAB_GRACE_MS : 0

    if (wait > 0) await Promise.race([opening, new Promise((resolve) => setTimeout(resolve, wait))])
  }

  const openedTab = tabs.list().length > before

  if (openedTab) await settle(tabs.page)

  return { openedTab }
}

const SCROLL_PX = 600

export async function scroll(
  page: Page,
  direction: "up" | "down" | "left" | "right",
): Promise<void> {
  const across = { left: -SCROLL_PX, right: SCROLL_PX, up: 0, down: 0 }[direction]
  const along = { up: -SCROLL_PX, down: SCROLL_PX, left: 0, right: 0 }[direction]

  await page.mouse.wheel(across, along)
}

/** How long an action's page load is waited for before the next look at the page. */
const SETTLE_MS = 5_000

/** Lets a navigation an action started reach its content before the page is looked at again. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => undefined)
}

/** What a wait waits for: text or an element to appear or go, the network to go quiet, or time. */
export interface WaitCondition {
  readonly text?: string | undefined
  readonly element?: Locator | undefined
  readonly state?: "visible" | "hidden" | undefined
  readonly networkIdle?: boolean | undefined
  readonly ms?: number | undefined
}

/** Waits for `condition`, up to `timeout`; a plain wait is capped by it too. */
export async function waitFor(
  page: Page,
  condition: WaitCondition,
  timeout: number,
): Promise<void> {
  const state = condition.state ?? "visible"

  if (condition.element !== undefined) {
    await condition.element.waitFor({ state, timeout })

    return
  }

  if (condition.text !== undefined) {
    await page.getByText(condition.text).first().waitFor({ state, timeout })

    return
  }

  if (condition.networkIdle) {
    await page.waitForLoadState("networkidle", { timeout })

    return
  }

  await page.waitForTimeout(Math.min(condition.ms ?? 1_000, timeout))
}
