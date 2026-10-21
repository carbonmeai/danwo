"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/", label: "Waitlist" },
  { href: "/signups", label: "Signups" },
] as const

/** The sidebar's links, with the current page marked. */
export function Nav() {
  const pathname = usePathname()

  return (
    <nav className="shell-nav" aria-label="Main">
      <span className="shell-nav-label">Launch</span>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
