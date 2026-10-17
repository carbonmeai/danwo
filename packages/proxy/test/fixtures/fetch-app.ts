/*
 * An app that makes the requests given as JSON in argv[2] with plain fetch and prints, for each,
 * the status and body it got, or the error. It knows nothing about the proxy.
 */
/** One request to make, as the test passes it in argv[2]. */
interface Wanted {
  readonly url: string
  readonly method?: string
  readonly body?: string
}

/** What came back for one request. */
type Got = { status: number; body: string } | { error: string }

function isWanted(value: unknown): value is Wanted {
  return (
    typeof value === "object" && value !== null && "url" in value && typeof value.url === "string"
  )
}

const parsed: unknown = JSON.parse(process.argv[2] ?? "[]")
const requests = Array.isArray(parsed) ? parsed.filter(isWanted) : []
const out: Got[] = []

for (const { url, method = "GET", body } of requests) {
  try {
    const res = await fetch(url, { method, ...(body !== undefined && { body }) })

    out.push({ status: res.status, body: await res.text() })
  } catch (error) {
    out.push({ error: error instanceof Error ? error.message : String(error) })
  }
}

process.stdout.write(JSON.stringify(out))
