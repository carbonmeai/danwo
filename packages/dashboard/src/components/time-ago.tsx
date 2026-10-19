import { ago, when } from "../lib/format.ts"

/** When something happened, as "3 minutes ago", with the full date on hover. */
export function TimeAgo({ at, now }: { readonly at: string; readonly now?: number }) {
  return (
    <time dateTime={at} title={when(at)} suppressHydrationWarning>
      {ago(at, now)}
    </time>
  )
}
