"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

const LINKS = [
  { href: "/admin/orders", label: "Orders", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/admin/stock", label: "Stock", icon: "M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 17l8 4 8-4" },
] as const

/** The admin's sidebar links, the current page marked. */
export function AdminNav() {
  const path = usePathname()

  return (
    <nav aria-label="Admin" className="shell-nav">
      <span className="shell-nav-label">Shop admin</span>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={path.startsWith(link.href) ? "page" : undefined}
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
      ))}
    </nav>
  )
}

/** The bar over an admin page: where it is, and the page's own actions. */
export function AdminTopbar({
  page,
  children,
}: {
  readonly page: string
  readonly children?: ReactNode
}) {
  return (
    <header className="shell-topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <span>Admin</span>
        <span aria-current="page">{page}</span>
      </nav>
      {children}
    </header>
  )
}
