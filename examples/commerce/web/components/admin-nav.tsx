"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/admin/orders", label: "Orders", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/admin/stock", label: "Stock", icon: "M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 17l8 4 8-4" },
] as const

/** The admin's sidebar links, the current page marked. */
export function AdminNav() {
  const path = usePathname()

  return (
    <nav aria-label="Admin" className="flex flex-col gap-0.5">
      {LINKS.map((link) => {
        const current = path.startsWith(link.href)

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] ${
              current
                ? "bg-surface font-medium text-ink shadow-card"
                : "text-muted hover:bg-subtle hover:text-ink"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d={link.icon} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
