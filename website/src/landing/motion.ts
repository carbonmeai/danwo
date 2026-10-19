/** Motion on the landing page: whether the visitor asked for less, and whether a part is on screen. */
import { type RefObject, useEffect, useState } from "react"

/** True when the visitor's system asks for reduced motion. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduce(query.matches)

    update()
    query.addEventListener("change", update)

    return () => query.removeEventListener("change", update)
  }, [])

  return reduce
}

/** True while at least `threshold` of the element is on screen. */
export function useInView(ref: RefObject<Element | null>, threshold = 0.2): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current

    if (!element) return undefined

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      {
        threshold,
      },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [ref, threshold])

  return visible
}

/** Calls `step` every `ms` while `active`, from the moment it turns on. */
export function useTicker(active: boolean, ms: number, step: () => void): void {
  useEffect(() => {
    if (!active) return undefined

    const timer = setInterval(step, ms)

    return () => clearInterval(timer)
  }, [active, ms, step])
}
