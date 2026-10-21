import Link from "next/link"
import { z } from "zod"

import { ProductCard } from "@/components/product-card"
import { Empty } from "@/components/ui"
import { api, Product } from "@/lib/api"
import { CATEGORIES } from "@/lib/format"

type Props = { readonly searchParams: Promise<{ readonly category?: string }> }

function Filter({ active }: { readonly active: string | undefined }) {
  const chips = [{ slug: undefined, name: "All" }, ...CATEGORIES]

  return (
    <nav aria-label="Categories" className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const selected = chip.slug === active

        return (
          <Link
            key={chip.name}
            href={chip.slug ? `/?category=${chip.slug}` : "/"}
            aria-current={selected ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
              selected
                ? "border-ink bg-ink text-bg"
                : "border-line-strong text-muted hover:border-ink hover:text-ink"
            }`}
          >
            {chip.name}
          </Link>
        )
      })}
    </nav>
  )
}

export default async function Storefront({ searchParams }: Props) {
  const { category } = await searchParams
  const products = await api("/products", z.array(Product))
  const shown = category ? products.filter((product) => product.category === category) : products

  return (
    <>
      <section className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <h1 className="text-[28px] font-semibold tracking-tight">Things for slow mornings</h1>
          <p className="mt-2 text-[15px] text-muted">
            Stoneware mugs, notebooks that lie flat and prints from a small studio. Made in small
            batches, shipped in a week.
          </p>
        </div>
        <Filter active={category} />
      </section>
      {shown.length === 0 ? (
        <Empty title="Nothing here yet">Try another category.</Empty>
      ) : (
        <ul aria-label="Products" className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {shown.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </ul>
      )}
    </>
  )
}
