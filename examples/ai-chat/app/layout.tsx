import "./globals.css"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { recentConversations } from "../lib/conversations.ts"
import { Nav } from "./nav.tsx"

export const metadata: Metadata = {
  title: { default: "Support · Paper & Clay", template: "%s · Paper & Clay" },
  description: "Ask Paper & Clay's support assistant about an order.",
}

/* The sidebar's conversations are read on every request. */
export const dynamic = "force-dynamic"

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  /* The chat works without the list, so a slow or failing read doesn't take the page down. */
  const conversations = await recentConversations().catch(() => [])

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="shell-sidebar">
            <div className="shell-brand">
              <span className="shell-logo" aria-hidden="true">
                P
              </span>
              Paper &amp; Clay
            </div>
            <Nav conversations={conversations} />
            <p className="shell-sidebar-footer">Tested with danwo</p>
          </aside>
          <div className="shell-main">{children}</div>
        </div>
      </body>
    </html>
  )
}
