/**
 * Controls with no name: a clickable `div` or a button that holds only an icon. The accessibility
 * tree lists such a control as `generic [cursor=pointer]` or a bare `button`, which says nothing
 * of what it does. The page's markup often does: an icon library's class (`lucide-trash`,
 * `fa-trash`), a `data-icon`, an SVG `<use href="#trash">` or an image file named `trash.svg`.
 * That word is added to the control's line in the agent's view as `[icon="trash"]`, so the agent
 * can tell the controls apart and act on them by ref, and a recording finds the control again by
 * its icon. A control with neither a name nor an icon word is one the text view cannot show; the
 * agent is told about those and may look at the page as an image.
 */
import { selectors, type Page } from "playwright-core"

/** The selector engine's name, as used in `danwo-icon={...}`. */
const ENGINE = "danwo-icon"

/** Unnamed controls a view looks up icons for, at most; the rest stay as the tree has them. */
const MAX_HINTS = 60

/** How long one lookup may take before the control is left without its icon. */
const HINT_TIMEOUT_MS = 500

/**
 * The icon word of an unnamed control, from its markup; undefined when it has none, or has a name
 * after all (text inside it, a label). Runs in the page, so everything it needs is inside it.
 */
function iconOf(element: Element): string | undefined {
  const label = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? ""

  if (label.trim() !== "" || (element.textContent ?? "").trim() !== "") return undefined

  /* Icon-library class names, each with the icon's own name in its group. */
  const libraries = [
    /^lucide-(.+)$/,
    /^fa-(.+)$/,
    /^bi-(.+)$/,
    /^mdi-(.+)$/,
    /^ri-(.+)$/,
    /^ti-(.+)$/,
    /^ph-(.+)$/,
    /^codicon-(.+)$/,
    /^tabler-icon-(.+)$/,
    /^heroicons?-[a-z]+-(.+)$/,
    /^icon-(.+)$/,
    /^(.+)-icon$/,
  ]
  /* Words such classes carry that are a style or a size, not an icon. */
  const styles = new Set([
    "solid",
    "regular",
    "light",
    "thin",
    "duotone",
    "brands",
    "sharp",
    "fw",
    "xs",
    "sm",
    "lg",
    "xl",
    "spin",
    "pulse",
    "button",
    "btn",
    "wrapper",
    "container",
  ])

  const word = (raw: string | null | undefined): string | undefined => {
    const said = (raw ?? "")
      .toLowerCase()
      .replace(/[-_.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    if (said === "" || said.length > 32 || !/[a-z]{2}/.test(said) || styles.has(said))
      return undefined
    if (/^\d+x$/.test(said)) return undefined

    return said
  }

  const fromClasses = (node: Element): string | undefined => {
    for (const name of node.classList)
      for (const library of libraries) {
        const found = word(library.exec(name)?.[1])

        if (found !== undefined) return found
      }

    return undefined
  }

  /* What an element of a given kind says of its icon: an image's file, a use's fragment. */
  const byKind: Record<string, (node: Element) => string | undefined> = {
    img: (node) => {
      const file = (node.getAttribute("src") ?? "").split(/[?#]/)[0]?.split("/").at(-1) ?? ""

      return /\.(svg|png|webp|gif|jpe?g)$/i.test(file) ? file.replace(/\.[a-z]+$/i, "") : undefined
    },
    use: (node) =>
      (node.getAttribute("href") ?? node.getAttribute("xlink:href") ?? "")
        .split("#")
        .at(-1)
        ?.replace(/^icon[-_]/, ""),
    "iconify-icon": (node) => node.getAttribute("icon")?.split(":").at(-1),
  }

  const fromNode = (node: Element): string | undefined =>
    word(node.getAttribute("data-icon") ?? node.getAttribute("data-lucide")) ??
    word(byKind[node.localName]?.(node)) ??
    fromClasses(node)

  for (const node of [element, ...[...element.querySelectorAll("*")].slice(0, 20)]) {
    const found = fromNode(node)

    if (found !== undefined) return found
  }

  return undefined
}

/**
 * Whether `element` is a control a person clicks, and not a part inside one: a button, a link, an
 * element with a clickable role or handler, or one whose pointer cursor its parent does not have.
 * Runs in the page.
 */
function isControl(element: Element): boolean {
  if (element.localName === "canvas") return false
  if (element.matches("button,a[href],[role=button],[role=link],[role=menuitem],[onclick]"))
    return true

  const parent = element.parentElement

  return (
    getComputedStyle(element).cursor === "pointer" &&
    (parent === null || getComputedStyle(parent).cursor !== "pointer")
  )
}

/** Whether `element` has a name the text view shows. Runs in the page. */
function hasName(element: Element): boolean {
  const label = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? ""

  return (
    label.trim() !== "" ||
    element.hasAttribute("aria-labelledby") ||
    (element.textContent ?? "").trim() !== "" ||
    element.querySelector("img[alt]:not([alt='']), svg > title") !== null
  )
}

/** What the engine looks for: unnamed controls with this icon, or unnamed controls with none. */
type Wanted = { readonly icon: string } | { readonly unnamed: true }

/**
 * The engine's script: `{"icon": "trash"}` finds the unnamed controls whose icon is "trash";
 * `{"unnamed": true}` finds the ones with no name and no icon either.
 */
function engineScript(): string {
  return `(() => {
    const iconOf = ${iconOf.toString()};
    const isControl = ${isControl.toString()};
    const hasName = ${hasName.toString()};
    const engine = {
      queryAll(root, body) {
        const wanted = JSON.parse(body);
        return [...root.querySelectorAll("*")].filter((element) => {
          if (!isControl(element) || hasName(element)) return false;
          const icon = iconOf(element);
          return typeof wanted.icon === "string" ? icon === wanted.icon : icon === undefined;
        });
      },
      query(root, body) {
        return engine.queryAll(root, body)[0] ?? null;
      },
    };
    return engine;
  })()`
}

/** The one registration of this process. */
let registered: Promise<void> | undefined

/** Registers the engine once per process; it must happen before the browser context is created. */
export function registerIconEngine(): Promise<void> {
  registered ??= selectors.register(ENGINE, { content: engineScript() })

  return registered
}

/** The selector of the unnamed controls `wanted` describes. */
export function iconSelector(wanted: Wanted): string {
  return `${ENGINE}=${JSON.stringify(wanted)}`
}

/** Roles a control with no name may have, besides any element the tree marks as clickable. */
const CONTROL_ROLES = new Set(["button", "link", "menuitem", "tab", "switch", "option"])

/** `- generic [ref=e4] [cursor=pointer]`: a role, no name, no text, and a ref. */
const UNNAMED = /^\s*- ([a-z][\w-]*) (?!")(?:[^:]*)\[ref=([a-z0-9]+)\][^:]*:?$/

/** The ref of an unnamed control's line, or undefined when the line is not one. */
function unnamedRef(line: string): string | undefined {
  const match = UNNAMED.exec(line)
  const role = match?.[1]

  if (role === undefined || match?.[2] === undefined) return undefined
  if (!CONTROL_ROLES.has(role) && !line.includes("[cursor=pointer]")) return undefined

  return match[2]
}

/** The line with `[icon="…"]` after its ref's marks, before a closing colon. */
function withIcon(line: string, icon: string): string {
  const mark = ` [icon=${JSON.stringify(icon)}]`

  return line.endsWith(":") ? `${line.slice(0, -1)}${mark}:` : `${line}${mark}`
}

/**
 * The tree with an `[icon="…"]` on the line of each unnamed control whose markup names its icon.
 * Lines of controls with a name are left as they are, so a page without unnamed controls reads
 * exactly as before.
 */
export async function withIcons(page: Page, tree: string): Promise<string> {
  const lines = tree.split("\n")
  const unnamed = lines
    .map((line, index) => ({ index, ref: unnamedRef(line) }))
    .filter((entry): entry is { index: number; ref: string } => entry.ref !== undefined)
    .slice(0, MAX_HINTS)

  if (unnamed.length === 0) return tree

  const icons = await Promise.all(
    unnamed.map(({ ref }) =>
      page
        .getByRef(ref)
        .evaluate(iconOf, undefined, { timeout: HINT_TIMEOUT_MS })
        .catch(() => undefined),
    ),
  )

  for (const [at, { index }] of unnamed.entries()) {
    const icon = icons[at]
    const line = lines[index]

    if (icon !== undefined && line !== undefined) lines[index] = withIcon(line, icon)
  }

  return lines.join("\n")
}

/** The icon a view's line says its control shows. */
export function iconIn(line: string): string | undefined {
  const raw = /\[icon=("(?:[^"\\]|\\.)*")\]/.exec(line)?.[1]

  if (raw === undefined) return undefined

  try {
    const parsed: unknown = JSON.parse(raw)

    return typeof parsed === "string" ? parsed : undefined
  } catch {
    return undefined
  }
}
