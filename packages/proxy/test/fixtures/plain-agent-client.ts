/**
 * A client that proxies plain HTTP itself, as axios does when HTTP_PROXY is set: it sends the
 * request to the proxy's address with the full URL as its path, through its own keep-alive
 * `http.Agent` (which the preload makes proxy-aware too). Prints each status, as JSON.
 */
import http from "node:http"

const target = new URL(process.argv[2] ?? "")
const proxy = new URL(process.env.HTTP_PROXY ?? "")

/** One POST to `target` through the proxy, the way a client that proxies on its own sends it. */
function post(): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: proxy.hostname,
        port: proxy.port,
        method: "POST",
        path: target.href,
        headers: { host: target.host, "content-type": "application/json" },
        agent: new http.Agent({ keepAlive: true }),
      },
      (response) => {
        response.resume()
        response.on("end", () => resolve(response.statusCode ?? 0))
      },
    )

    request.on("error", reject)
    request.end("{}")
  })
}

const statuses: number[] = []

for (let i = 0; i < 3; i++) statuses.push(await post())

console.log(JSON.stringify(statuses))
