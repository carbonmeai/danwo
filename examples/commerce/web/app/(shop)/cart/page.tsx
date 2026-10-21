import Link from "next/link"

import { Empty, Notice, PageTitle } from "@/components/ui"
import { api, Cart } from "@/lib/api"
import { money } from "@/lib/format"
import { cartId, savedEmail } from "@/lib/session"

export const metadata = { title: "Cart" }

type Props = { readonly searchParams: Promise<{ readonly error?: string }> }

async function currentCart(): Promise<Cart | undefined> {
  const id = await cartId()

  return id ? api(`/carts/${id}`, Cart) : undefined
}

function Line({ line }: { readonly line: Cart["lines"][number] }) {
  return (
    <li className="flex items-center gap-4 py-4">
      {/* The picture is decoration here: the name next to it says what it is. */}
      <img
        src={`/img/${line.slug}`}
        alt=""
        width={64}
        height={64}
        className="size-16 rounded-lg bg-subtle"
      />
      <div className="flex-1">
        <Link href={`/products/${line.slug}`} className="font-medium hover:underline">
          {line.name}
        </Link>
        <p className="text-[13px] text-muted">{money(line.unitCents)} each</p>
      </div>
      <form method="post" action={`/cart/items/${line.slug}`} className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`quantity-${line.slug}`}>
          Quantity of {line.name}
        </label>
        <select
          id={`quantity-${line.slug}`}
          name="quantity"
          defaultValue={String(line.quantity)}
          className="field w-16"
        >
          {Array.from({ length: 10 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">
          Update
        </button>
        <button
          type="submit"
          name="remove"
          value="1"
          className="btn btn-sm text-muted hover:text-danger"
          aria-label={`Remove ${line.name}`}
        >
          Remove
        </button>
      </form>
      <p className="w-20 text-right font-medium">{money(line.unitCents * line.quantity)}</p>
    </li>
  )
}

export default async function CartPage({ searchParams }: Props) {
  const { error } = await searchParams
  const [cart, email] = await Promise.all([currentCart(), savedEmail()])

  if (!cart || cart.lines.length === 0)
    return (
      <>
        <PageTitle title="Your cart" />
        <Empty title="Your cart is empty">
          <Link href="/" className="btn btn-primary mt-3">
            Browse the shop
          </Link>
        </Empty>
      </>
    )

  return (
    <>
      <PageTitle title="Your cart" />
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
        <ul aria-label="Cart" className="card divide-y divide-line px-5">
          {cart.lines.map((line) => (
            <Line key={line.slug} line={line} />
          ))}
        </ul>
        <section aria-label="Checkout" className="card flex flex-col gap-4 p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Subtotal</span>
            <span className="text-[18px] font-semibold" data-testid="cart-total">
              {money(cart.totalCents)}
            </span>
          </div>
          <p className="text-[13px] text-muted">
            Shipping is free. You pay on Stripe&apos;s secure page.
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
          <form method="post" action="/cart/checkout" className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] text-muted">
              Email for your receipt
              <input
                type="email"
                name="email"
                required
                defaultValue={email}
                autoComplete="email"
                className="field"
              />
            </label>
            <button type="submit" className="btn btn-primary h-10">
              Checkout
            </button>
          </form>
        </section>
      </div>
    </>
  )
}
