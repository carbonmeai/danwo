/**
 * Sends one request through the proxy (from its environment) with the method and headers it is
 * given, as a browser's image or `fetch()` would arrive, and prints the status and the start of
 * the body: `node headers-client.ts <url> <method> [name=value ...]`.
 */
const [url = "", method = "GET", ...pairs] = process.argv.slice(2)

const headers = pairs.map((pair): [string, string] => {
  const at = pair.indexOf("=")

  return [pair.slice(0, at), pair.slice(at + 1)]
})

const response = await fetch(url, { method, headers }).catch((error: unknown) => ({
  status: 0,
  text: async () => String(error),
}))

console.log(`${response.status} ${(await response.text()).slice(0, 80)}`)
