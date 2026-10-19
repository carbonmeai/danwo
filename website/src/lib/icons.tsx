/**
 * Sidebar icons for the docs: a frontmatter or folder `icon` that is a path (`/icons/stripe.svg`)
 * shows that image, as provider pages do, and `light|dark` paths show one per theme; any other
 * value names a Lucide icon.
 */
import type { LoaderPluginOption } from "fumadocs-core/source"
import { icons, type LucideIcon } from "lucide-react"
import { createElement, Fragment, type ReactNode } from "react"

const LUCIDE: Readonly<Record<string, LucideIcon>> = icons

/** An image icon, shown only in `theme` when one is given. */
function image(src: string, theme?: "light" | "dark"): ReactNode {
  return createElement("img", {
    key: src,
    src,
    alt: "",
    width: 16,
    height: 16,
    ...(theme && { className: `only-${theme}` }),
  })
}

/** The element for one icon value, or nothing for an unknown name. */
export function resolveIcon(icon: string | undefined): ReactNode {
  if (icon === undefined) return undefined

  const [light = "", dark] = icon.split("|")

  if (light.startsWith("/"))
    return dark === undefined
      ? image(light)
      : createElement(Fragment, null, image(light, "light"), image(dark, "dark"))

  const Icon = LUCIDE[icon]

  return Icon === undefined ? undefined : createElement(Icon)
}

/** A page tree node with its icon name replaced by an element. */
function replace<T extends { icon?: ReactNode }>(node: T): T {
  if (node.icon === undefined || typeof node.icon === "string") node.icon = resolveIcon(node.icon)

  return node
}

/** Replaces the page tree's icon names with elements. */
export function iconsPlugin(): LoaderPluginOption {
  return {
    name: "danwo:icons",
    transformPageTree: { file: replace, folder: replace, separator: replace },
  }
}
