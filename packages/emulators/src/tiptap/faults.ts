const json = { "content-type": "application/json" }

/** What any REST call can meet: a server error and a dropped connection. */
const COMMON = [
  {
    kind: "status",
    status: 500,
    headers: json,
    body: JSON.stringify({ error: "Internal Server Error" }),
  },
  { kind: "reset" },
] as const

/**
 * `danwo matrix`'s Tiptap Cloud faults on the REST API: a rate limit and a server error, a
 * dropped connection, and on writes an answer lost after the change was made. The collaboration
 * socket gets the matrix's socket faults (refused, dropped); a refused token and slow syncs are
 * set from a test with `tiptapCollab(tiptap).trouble(...)`.
 */
export function tiptapOutboundFaults(call: { method: string; path: string }) {
  if (!call.path.startsWith("/api/")) return []

  const limited = {
    kind: "status",
    status: 429,
    headers: { ...json, "retry-after": "1" },
    body: JSON.stringify({ error: "Too Many Requests" }),
  } as const

  return call.method === "GET"
    ? [limited, ...COMMON]
    : [limited, ...COMMON, { kind: "reset-after" } as const]
}
