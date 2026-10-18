/*
 * An app with a short client timeout: it POSTs a charge, gives up after `argv[3]` ms, and tries
 * once more. Prints how each try ended as JSON. It knows nothing about the proxy.
 */
const url = process.argv[2] ?? ""
const timeoutMs = Number(process.argv[3] ?? 300)

/** One try at the charge: its status, or why it ended without one. */
async function charge(signal?: AbortSignal): Promise<number | string> {
  try {
    const res = await fetch(url, { method: "POST", body: "amount=500", ...(signal && { signal }) })

    return res.status
  } catch (error) {
    return error instanceof Error ? error.name : String(error)
  }
}

const first = await charge(AbortSignal.timeout(timeoutMs))
const second = await charge()

console.log(JSON.stringify({ first, second }))
