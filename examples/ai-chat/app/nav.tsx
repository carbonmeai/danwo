"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import type { Conversation } from "../lib/conversations.ts"

/** The sidebar's links, the recent conversations among them, with the current page marked. */
export function Nav({ conversations }: { readonly conversations: readonly Conversation[] }) {
  const pathname = usePathname()
  const here = (href: string) => (pathname === href ? "page" : undefined)

  return (
    <nav className="shell-nav" aria-label="Main">
      <span className="shell-nav-label">Support</span>
      <Link href="/" aria-current={here("/")}>
        New conversation
      </Link>
      <Link href="/tickets" aria-current={here("/tickets")}>
        Tickets
      </Link>
      {conversations.length > 0 && <span className="shell-nav-label">Recent</span>}
      {conversations.map((conversation) => (
        <Link
          key={conversation.id}
          href={`/c/${conversation.id}`}
          aria-current={here(`/c/${conversation.id}`)}
          className="truncate"
          title={conversation.title}
        >
          {conversation.title}
        </Link>
      ))}
    </nav>
  )
}
