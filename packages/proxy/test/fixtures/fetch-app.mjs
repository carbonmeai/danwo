/*
 * An app that makes the requests given as JSON in argv[2] with plain fetch and prints, for each,
 * the status and body it got, or the error. It knows nothing about the proxy.
 */
const requests = JSON.parse(process.argv[2] ?? "[]")
const out = []

for (const { url, method = "GET", body } of requests) {
  try {
    const res = await fetch(url, { method, ...(body !== undefined && { body }) })

    out.push({ status: res.status, body: await res.text() })
  } catch (error) {
    out.push({ error: error instanceof Error ? error.message : String(error) })
  }
}

process.stdout.write(JSON.stringify(out))
