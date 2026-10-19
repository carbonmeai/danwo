import { useNavigate } from "@tanstack/react-router"

/**
 * A list's filter text kept in the page's address as `q`, so a copied link opens on the same
 * filtered list: the text to start from, and how each change goes back into the address.
 */
export function useKeptQuery(q: string | undefined) {
  const navigate = useNavigate()

  return {
    query: q ?? "",
    onChange: (next: string) =>
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, q: next || undefined }),
        replace: true,
      }),
  }
}
