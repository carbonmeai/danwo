/**
 * What Paper & Clay sells. One list seeds all three places a product lives: the shop's database
 * (name, price, stock), Stripe (a product and a price with the same id the database stores) and
 * the S3 bucket (its picture). Tests read the starting stock from here too.
 */
import { readFileSync } from "node:fs"

/** One product as the shop seeds it. */
export interface SeedProduct {
  readonly slug: string
  readonly name: string
  readonly category: "mugs" | "notebooks" | "prints"
  readonly description: string
  readonly priceCents: number
  readonly stock: number
  /** The Stripe price the shop charges for it, seeded with this id. */
  readonly stripePrice: string
}

export const CATALOG: readonly SeedProduct[] = [
  {
    slug: "stoneware-mug",
    name: "Stoneware mug",
    category: "mugs",
    description: "A heavy, hand-glazed mug that keeps coffee warm. Holds 350 ml.",
    priceCents: 2400,
    stock: 10,
    stripePrice: "price_stoneware_mug",
  },
  {
    slug: "speckled-mug",
    name: "Speckled mug",
    category: "mugs",
    description: "Cream glaze with iron speckles, thrown on the wheel. Holds 300 ml.",
    priceCents: 1800,
    stock: 12,
    stripePrice: "price_speckled_mug",
  },
  {
    slug: "little-mug",
    name: "Little mug",
    category: "mugs",
    description: "A small cup for espresso or tea, in a deep blue glaze. Holds 150 ml.",
    priceCents: 1400,
    stock: 20,
    stripePrice: "price_little_mug",
  },
  {
    slug: "dot-grid-notebook",
    name: "Dot grid notebook",
    category: "notebooks",
    description: "A5, 160 pages of 100 gsm paper with a 5 mm dot grid. Lies flat.",
    priceCents: 1600,
    stock: 30,
    stripePrice: "price_dot_grid_notebook",
  },
  {
    slug: "pocket-notebooks",
    name: "Pocket notebooks, set of 3",
    category: "notebooks",
    description: "Three A6 notebooks with kraft covers: plain, lined and squared.",
    priceCents: 1200,
    stock: 25,
    stripePrice: "price_pocket_notebooks",
  },
  {
    slug: "hills-print",
    name: "Hills print",
    category: "prints",
    description: "A risograph print of rolling hills in two inks. A3, signed.",
    priceCents: 3500,
    stock: 6,
    stripePrice: "price_hills_print",
  },
  {
    slug: "tide-print",
    name: "Tide print",
    category: "prints",
    description: "Waves at low tide, printed in blue on cotton paper. A4.",
    priceCents: 2800,
    stock: 0,
    stripePrice: "price_tide_print",
  },
]

/** The bucket product pictures live in. */
export const IMAGES_BUCKET = "paper-and-clay-images"

/** Where a product's picture is stored in the bucket. */
export function imageKey(slug: string): string {
  return `products/${slug}.svg`
}

/** A product's picture, as the seed uploads it. */
export function imageOf(slug: string): string {
  return readFileSync(new URL(`./images/${slug}.svg`, import.meta.url), "utf8")
}

/** The starting stock of the product with this slug. */
export function seededStock(slug: string): number {
  return CATALOG.find((product) => product.slug === slug)?.stock ?? 0
}
