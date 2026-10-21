import Link from "next/link"

import { Badge } from "@/components/ui"
import type { Product } from "@/lib/api"
import { money } from "@/lib/format"

/** How much is left, when it is worth saying. */
export function StockBadge({ stock }: { readonly stock: number }) {
  if (stock === 0) return <Badge tone="danger">Sold out</Badge>
  if (stock <= 6) return <Badge tone="warning">Only {stock} left</Badge>

  return null
}

/** A product's picture, from the bucket through the storefront. */
export function ProductImage({
  product,
  className = "",
}: {
  readonly product: Product
  readonly className?: string
}) {
  return (
    <img
      src={`/img/${product.slug}`}
      alt={product.name}
      width={400}
      height={400}
      className={`aspect-square w-full bg-subtle object-cover ${className}`}
    />
  )
}

export function ProductCard({ product }: { readonly product: Product }) {
  return (
    <li>
      <Link
        href={`/products/${product.slug}`}
        className="group card block overflow-hidden transition-colors hover:border-border-strong"
      >
        <ProductImage product={product} className="transition-opacity group-hover:opacity-95" />
        <div className="flex items-start justify-between gap-3 p-4">
          <div>
            <h2 className="text-base font-medium">{product.name}</h2>
            <p className="mt-0.5 text-sm text-muted">{money(product.priceCents)}</p>
          </div>
          <StockBadge stock={product.stock} />
        </div>
      </Link>
    </li>
  )
}
