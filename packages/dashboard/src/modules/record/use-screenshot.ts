import { useEffect, useRef, useState } from "react"

import { fetchScreenshot } from "./record-api.ts"

/** Screenshots already fetched, by record folder and file, shared by thumbnails and the big view. */
const shots = new Map<string, Promise<string>>()

function screenshot(dir: string, file: string): Promise<string> {
  const key = `${dir}\n${file}`
  const known = shots.get(key)

  if (known) return known

  const loading = fetchScreenshot({ data: { dir, file } })

  shots.set(key, loading)

  return loading
}

/** Calls `load` once `element` comes within 200px of the viewport; returns how to stop watching. */
function whenNear(element: Element | null, load: () => void): () => void {
  const watcher = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        watcher.disconnect()
        load()
      }
    },
    { rootMargin: "200px" },
  )

  if (element) watcher.observe(element)

  return () => watcher.disconnect()
}

/** A step's screenshot as a data URL, fetched once the element scrolls near the viewport. */
export function useScreenshot(dir: string, file: string | undefined, lazy: boolean) {
  const [src, setSrc] = useState<string>()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true

    let stop = () => {}

    setSrc(undefined)

    if (file !== undefined) {
      const load = () =>
        void screenshot(dir, file).then((url) => {
          if (live) setSrc(url)
        })

      if (lazy && typeof IntersectionObserver !== "undefined") stop = whenNear(ref.current, load)
      else load()
    }

    return () => {
      live = false
      stop()
    }
  }, [dir, file, lazy])

  return { src, ref }
}
