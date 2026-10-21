import Link from "next/link"
import type { ReactNode } from "react"

import { api, Cart } from "@/lib/api"
import { cartId } from "@/lib/session"

/** How many items the guest's cart holds, for the header; 0 when the API cannot say. */
async function itemsInCart(): Promise<number> {
  const id = await cartId()

  if (!id) return 0

  try {
    const cart = await api(`/carts/${id}`, Cart)

    return cart.lines.reduce((sum, line) => sum + line.quantity, 0)
  } catch {
    return 0
  }
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="var(--accent)" />
        <path d="M7 8h7a3 3 0 0 1 0 6H9v3" fill="none" stroke="var(--accent-ink)" strokeWidth="2" />
      </svg>
      Paper &amp; Clay
    </Link>
  )
}

export default async function ShopLayout({ children }: { readonly children: ReactNode }) {
  const count = await itemsInCart()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Logo />
          <div className="flex flex-1 items-center gap-5 text-[13px] text-muted">
            <Link href="/" className="hover:text-ink">
              Shop
            </Link>
            <Link href="/orders" className="hover:text-ink">
              My orders
            </Link>
          </div>
          <Link
            href="/cart"
            className="btn btn-secondary btn-sm"
            aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
          >
            Cart
            <span className="rounded-full bg-accent px-1.5 text-[11px] leading-5 text-accent-ink">
              {count}
            </span>
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 text-xs text-faint">
          <span>Paper &amp; Clay · made in small batches</span>
          <Link href="/admin/orders" className="hover:text-muted">
            Shop admin
          </Link>
        </div>
      </footer>
    </div>
  )
}
