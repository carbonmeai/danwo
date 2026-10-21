/** A product's picture: streamed on from the API, which reads it from the S3 bucket. */
import { apiPath } from "@/lib/api"

type Context = { readonly params: Promise<{ readonly slug: string }> }

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const { slug } = await params
  const upstream = await fetch(apiPath(`/products/${encodeURIComponent(slug)}/image`), {
    cache: "no-store",
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": upstream.headers.get("cache-control") ?? "no-store",
    },
  })
}
