/** A small router over the browser's history: the current path, going somewhere, and a link. */
import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react"

function subscribe(changed: () => void): () => void {
  window.addEventListener("popstate", changed)

  return () => window.removeEventListener("popstate", changed)
}

/** The path the browser is at, kept in step as it changes. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

/** Goes to `to` without reloading the page. */
export function navigate(to: string): void {
  window.history.pushState(null, "", to)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

/** A link that goes to `to` in place, unless the reader asks for a new tab. */
export function Link({
  to,
  ...rest
}: { readonly to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return

    event.preventDefault()
    navigate(to)
  }

  return <a href={to} onClick={follow} {...rest} />
}
