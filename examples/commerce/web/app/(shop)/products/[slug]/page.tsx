import Link from "next/link"
import { notFound } from "next/navigation"

import { ProductImage, StockBadge } from "@/components/product-card"
import { api, ApiError, Product } from "@/lib/api"
import { CATEGORIES, money } from "@/lib/format"

type Props = { readonly params: Promise<{ readonly slug: string }> }

async function productOf(slug: string) {
  try {
    return await api(`/products/${encodeURIComponent(slug)}`, Product)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params

  return { title: (await productOf(slug)).name }
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const product = await productOf(slug)
  const category = CATEGORIES.find((c) => c.slug === product.category)
  const max = Math.min(product.stock, 10)

  return (
    <div className="grid gap-10 md:grid-cols-2">
      <ProductImage product={product} className="card" />
      <div className="flex flex-col gap-5 py-2">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link href="/" className="hover:text-fg">
            Shop
          </Link>
          {category && (
            <>
              {" / "}
              <Link href={`/?category=${category.slug}`} className="hover:text-fg">
                {category.name}
              </Link>
            </>
          )}
        </nav>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <p className="mt-1 flex items-center gap-3 text-lg">
            <span data-testid="price">{money(product.priceCents)}</span>
            <StockBadge stock={product.stock} />
          </p>
        </div>
        <p className="max-w-md text-base text-muted">{product.description}</p>
        {product.stock > 0 ? (
          <form method="post" action="/cart/items" className="flex items-end gap-3">
            <input type="hidden" name="slug" value={product.slug} />
            <label className="flex flex-col gap-1 text-sm text-muted">
              Quantity
              <select name="quantity" defaultValue="1" className="input w-20">
                {Array.from({ length: max }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary">
              Add to cart
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted">Sold out for now. A new batch is on its way.</p>
        )}
        <ul className="mt-2 grid gap-1 border-t border-border pt-5 text-sm text-muted">
          <li>Ships within 5 working days</li>
          <li>Free returns for 30 days</li>
        </ul>
      </div>
    </div>
  )
}
