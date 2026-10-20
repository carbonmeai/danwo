/**
 * The proxy's interception library prints `Response error: read ECONNRESET` (or `write EPIPE`)
 * whenever a client goes away while its response is still being written. Browsers do that all the
 * time at the end of a page or a test: they drop server-sent event streams, long polls and
 * sockets. Those lines say nothing about the run, so they are kept out of the output while any
 * proxy runs. Every other line passes through, and `DANWO_DEBUG=proxy` shows the dropped ones too.
 */

/** The ways a client going away shows up on the socket the response was being written to. */
const DROPPED =
  /\b(?:ECONNRESET|EPIPE|ECONNABORTED|ERR_STREAM_PREMATURE_CLOSE|ERR_STREAM_DESTROYED)\b|socket hang up|aborted/

/** The line prefix the interception library writes response errors with. */
const PREFIX = "Response error:"

function messageOf(value: unknown): string {
  return value instanceof Error
    ? `${value.message} ${String(Reflect.get(value, "code") ?? "")}`
    : String(value)
}

/** Whether a console line is the interception library reporting that a client went away. */
export function isDroppedClientLine(args: readonly unknown[]): boolean {
  return args[0] === PREFIX && DROPPED.test(messageOf(args[1]))
}

/** Whether `DANWO_DEBUG` (a comma-separated list) names `topic`. */
export function debugging(topic: string, setting = process.env["DANWO_DEBUG"]): boolean {
  return (setting ?? "").split(",").some((part) => part.trim() === topic || part.trim() === "*")
}

let holders = 0
let original: typeof console.log | undefined

/**
 * Keeps dropped-client lines out of `console.log` until the returned function is called; proxies
 * that run at once share one filter, removed when the last of them stops.
 */
export function quietDroppedClients(): () => void {
  if (holders === 0) {
    const write = console.log

    original = write

    console.log = (...args: unknown[]) => {
      if (isDroppedClientLine(args) && !debugging("proxy")) return

      write(...args)
    }
  }

  holders += 1

  let released = false

  return () => {
    if (released) return
    released = true
    holders -= 1

    if (holders === 0 && original !== undefined) {
      console.log = original
      original = undefined
    }
  }
}
