/**
 * An app under test that knows nothing about time travel: it answers `GET /now` with its own
 * `Date.now()` and how long a 100 ms timer really took.
 */
import { createServer } from "node:http"

const server = createServer((_request, response) => {
  const started = performance.now()

  setTimeout(() => {
    response.setHeader("content-type", "application/json")
    response.end(
      JSON.stringify({
        now: Date.now(),
        constructed: new Date().getTime(),
        isDate: new Date() instanceof Date,
        ownStatics: ["UTC", "parse", "now"].every((name) => Object.hasOwn(Date, name)),
        timerMs: performance.now() - started,
      }),
    )
  }, 100)
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()

  process.stdout.write(`${typeof address === "object" && address ? address.port : 0}\n`)
})
