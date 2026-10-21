import Link from "next/link"
import type { ReactNode } from "react"

import { AdminNav } from "@/components/admin-nav"

export const metadata = { title: { default: "Admin", template: "%s · Admin · Paper & Clay" } }

/**
 * The admin's app shell: a sidebar with the shop's name and the sections, and the page beside it.
 * It has no sign-in, being an example: put your own auth in front of it.
 */
export default function AdminLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-sidebar px-3 py-4">
        <div className="mb-5 flex items-center gap-2 px-2.5">
          <span className="grid size-6 place-items-center rounded-md bg-accent text-[11px] font-semibold text-accent-ink">
            P
          </span>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold">Paper &amp; Clay</p>
            <p className="text-[11px] text-faint">Shop admin</p>
          </div>
        </div>
        <AdminNav />
        <Link href="/" className="mt-auto px-2.5 text-[12px] text-muted hover:text-ink">
          ← Back to the shop
        </Link>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-7">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  )
}
