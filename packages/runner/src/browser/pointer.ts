/**
 * A pointer drawn into filmed pages, so a recording shows what each action did: a cursor that
 * glides to the element, a box around it, a ripple where it clicks and a badge while it types.
 * It lives in a shadow root on top of the page, takes no pointer events and changes no layout,
 * and it is hidden from every screenshot that is compared or read by a model.
 */
import type { BrowserContext, Locator as PlaywrightLocator } from "playwright-core"

/** What the pointer shows for an action: a click, typing into a field, or a hover. */
export type PointerKind = "click" | "type" | "hover"

/** The id of the element the pointer is drawn in. */
export const POINTER_HOST = "danwo-pointer"

/** A screenshot style that hides the pointer, for baselines and the model's screenshots. */
export const HIDE_POINTER = `#${POINTER_HOST} { display: none !important; }`

/** How long the pointer takes to reach an element; the action waits for it before it runs. */
export const POINTER_MS = 180

/** The box of an element in CSS pixels of the viewport. */
interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

declare global {
  interface Window {
    /** Moves the pointer to `box` and shows `kind` there; drawn by the init script below. */
    danwoPoint?: (box: Box, kind: PointerKind) => void
  }
}

/** Runs in every page before its own scripts: builds the overlay and exposes `danwoPoint`. */
function installPointer(settings: { host: string; moveMs: number }): void {
  const layer = document.createElement("div")

  layer.id = settings.host
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;overflow:hidden"

  const root = layer.attachShadow({ mode: "closed" })
  const style = document.createElement("style")

  style.textContent = `
    .cursor { position:absolute; left:0; top:0; width:18px; height:18px; transition: transform ${settings.moveMs}ms ease-out; }
    .cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
    .box { position:absolute; border:2px solid #2563eb; border-radius:6px; background:rgba(37,99,235,.08); opacity:0; transition: opacity 120ms; }
    .ripple { position:absolute; width:44px; height:44px; margin:-22px 0 0 -22px; border-radius:50%; border:3px solid #2563eb; background:rgba(37,99,235,.28); animation: ripple 600ms ease-out forwards; }
    .badge { position:absolute; padding:2px 6px; border-radius:6px; background:#111827; color:#fff; font:600 11px/15px system-ui,sans-serif; }
    @keyframes ripple { from { transform: scale(.25); opacity: 1 } 60% { opacity: .8 } to { transform: scale(1.3); opacity: 0 } }
  `
  root.append(style)

  const cursor = document.createElement("div")

  cursor.className = "cursor"
  cursor.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1l13 7-6 1.5L6 16z" fill="#111827" stroke="#fff" stroke-width="1.2"/></svg>'

  const outline = document.createElement("div")

  outline.className = "box"
  root.append(outline, cursor)

  const mount = () => {
    if (!layer.isConnected) document.documentElement.append(layer)
  }

  let clearOutline: ReturnType<typeof setTimeout> | undefined

  window.danwoPoint = (box, kind) => {
    mount()

    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    cursor.style.transform = `translate(${x}px, ${y}px)`
    Object.assign(outline.style, {
      left: `${box.x - 3}px`,
      top: `${box.y - 3}px`,
      width: `${box.width + 6}px`,
      height: `${box.height + 6}px`,
      opacity: "1",
    })
    clearTimeout(clearOutline)
    clearOutline = setTimeout(() => (outline.style.opacity = "0"), 900)

    setTimeout(() => {
      const mark = document.createElement("div")

      if (kind === "click") {
        mark.className = "ripple"
        Object.assign(mark.style, { left: `${x}px`, top: `${y}px` })
      } else if (kind === "type") {
        mark.className = "badge"
        mark.textContent = "typing"
        Object.assign(mark.style, { left: `${box.x}px`, top: `${Math.max(box.y - 20, 0)}px` })
      } else return

      root.append(mark)
      setTimeout(() => mark.remove(), 900)
    }, settings.moveMs)
  }

  if (document.documentElement) mount()
  else document.addEventListener("DOMContentLoaded", mount, { once: true })
}

/** The contexts that draw the pointer; actions in any other context skip it, and its wait. */
const drawing = new WeakSet<BrowserContext>()

/** Draws the pointer into every page `context` opens, from before its own scripts run. */
export async function showPointer(context: BrowserContext): Promise<void> {
  await context.addInitScript(installPointer, { host: POINTER_HOST, moveMs: POINTER_MS })
  drawing.add(context)
}

/** How long to look for an element's box before giving up on drawing the pointer for it. */
const FIND_MS = 1000

/**
 * Moves the pointer to `target` and shows `kind` there, then waits for it to arrive. Never throws:
 * an element not there yet is left to the action itself, which waits for it and names it.
 */
export async function pointAt(target: PlaywrightLocator, kind: PointerKind): Promise<void> {
  if (!drawing.has(target.page().context())) return

  try {
    const box = await target.boundingBox({ timeout: FIND_MS })

    if (box === null) return

    await target
      .page()
      .evaluate(([at, shown]) => window.danwoPoint?.(at, shown), [box, kind] as const)
    await new Promise((resolve) => setTimeout(resolve, POINTER_MS))
  } catch {
    /* The page navigated or the element is not there yet: the action reports it. */
  }
}
