import { createElement, type ReactNode, useEffect, useRef, useState } from "react"

/** Elements a reveal can render as. */
type RevealTag = "div" | "h2" | "p" | "article"

/**
 * Fades its content in the first time it scrolls into view. Server-rendered pages show it at
 * once, so the page reads without scripts; the fade only starts once the page is live.
 */
export function Reveal({
  as = "div",
  className,
  children,
}: {
  readonly as?: RevealTag
  readonly className?: string
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [state, setState] = useState<"static" | "hidden" | "shown">("static")

  useEffect(() => {
    const element = ref.current

    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined

    if (element.getBoundingClientRect().top < window.innerHeight) return undefined

    setState("hidden")

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return

        setState("shown")
        observer.disconnect()
      },
      { rootMargin: "0px 0px -8% 0px" },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const classes = [className, state !== "static" && "rv", state === "shown" && "in"]
    .filter(Boolean)
    .join(" ")

  return createElement(as, { ref, className: classes || undefined }, children)
}
