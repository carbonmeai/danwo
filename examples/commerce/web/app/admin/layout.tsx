import Link from "next/link"
import type { ReactNode } from "react"

import { AdminNav } from "@/components/admin-nav"

export const metadata = { title: { default: "Admin", template: "%s · Admin · Paper & Clay" } }

/**
 * The admin's app shell, from the examples' kit: a sidebar with the shop's name and the sections,
 * and the page beside it. It has no sign-in, being an example: put your own auth in front of it.
 */
export default function AdminLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <span className="shell-logo" aria-hidden="true">
            P
          </span>
          Paper &amp; Clay
        </div>
        <AdminNav />
        <Link href="/" className="shell-sidebar-footer hover:text-fg">
          ← Back to the shop
        </Link>
      </aside>
      <div className="shell-main">{children}</div>
    </div>
  )
}
