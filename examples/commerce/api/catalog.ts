/**
 * The catalogue: products from the database, and their pictures from the S3 bucket. The browser
 * never talks to S3: the storefront asks the API, which reads the object with the AWS SDK (three
 * attempts on a 5xx or a dropped connection) and streams it back.
 */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { asc, eq } from "drizzle-orm"
import { Hono } from "hono"

import { query } from "./db/client.ts"
import { products } from "./db/schema.ts"
import { retrying } from "./retry.ts"
import { settings } from "./settings.ts"

const s3 = new S3Client({
  region: settings.AWS_REGION,
  ...(settings.AWS_ENDPOINT_URL_S3 && { endpoint: settings.AWS_ENDPOINT_URL_S3 }),
  forcePathStyle: true,
  maxAttempts: 3,
})

/** A product as the storefront shows it. */
export function publicProduct(row: typeof products.$inferSelect) {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    stock: row.stock,
  }
}

/** A picture's bytes and type, read from the bucket. */
async function picture(key: string): Promise<{ bytes: Uint8Array; type: string }> {
  /* The SDK already retried; one more round covers a reset it does not count as retryable. */
  return retrying({ name: `s3 GetObject ${key}`, attempts: 2, retryable: () => true }, async () => {
    const object = await s3.send(new GetObjectCommand({ Bucket: settings.IMAGES_BUCKET, Key: key }))

    return {
      bytes: (await object.Body?.transformToByteArray()) ?? new Uint8Array(),
      type: object.ContentType ?? "application/octet-stream",
    }
  })
}

export const catalog = new Hono()
  .get("/products", async (c) => {
    const rows = await query("list products", (db) =>
      db.select().from(products).orderBy(asc(products.id)),
    )

    return c.json(rows.map(publicProduct))
  })
  .get("/products/:slug", async (c) => {
    const [row] = await query("read product", (db) =>
      db
        .select()
        .from(products)
        .where(eq(products.slug, c.req.param("slug"))),
    )

    return row ? c.json(publicProduct(row)) : c.json({ error: "no such product" }, 404)
  })
  .get("/products/:slug/image", async (c) => {
    const [row] = await query("read product", (db) =>
      db
        .select()
        .from(products)
        .where(eq(products.slug, c.req.param("slug"))),
    )

    if (!row) return c.json({ error: "no such product" }, 404)

    const { bytes, type } = await picture(row.imageKey)

    return c.body(bytes.slice().buffer, 200, {
      "content-type": type,
      "cache-control": "public, max-age=300",
    })
  })
