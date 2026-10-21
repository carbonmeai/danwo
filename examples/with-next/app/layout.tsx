import "./globals.css"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { Nav } from "./nav.tsx"

export const metadata: Metadata = {
  title: "Lumen waitlist",
  description: "Join the Lumen waitlist.",
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="shell-sidebar">
            <div className="shell-brand">
              <span className="shell-logo" aria-hidden="true">
                L
              </span>
              Lumen
            </div>
            <Nav />
            <p className="shell-sidebar-footer">Tested with danwo</p>
          </aside>
          <div className="shell-main">{children}</div>
        </div>
      </body>
    </html>
  )
}
