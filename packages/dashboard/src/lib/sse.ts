/**
 * Server-sent events: a response that stays open and carries named events to an `EventSource`.
 * The stream ends when its source closes it or the browser goes away; either way its cleanup runs
 * once.
 */

/** How often an idle stream says it is still there, so proxies and browsers keep it open. */
const KEEPALIVE_MS = 15_000

/** What a stream's source gets: a way to send an event, and to end the stream. */
export interface EventSink {
  send(event: string, data: unknown): void
  close(): void
}

/**
 * A `text/event-stream` response. `start` begins sending and returns its cleanup, which runs once
 * when the stream ends for any reason.
 */
export function eventStream(request: Request, start: (sink: EventSink) => () => void): Response {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let cleanup: (() => void) | undefined
  let keepalive: ReturnType<typeof setInterval> | undefined
  let ended = false

  const write = (text: string) => {
    if (!ended) controller?.enqueue(encoder.encode(text))
  }

  /** Stops everything; `closing` also ends the response (not when the browser already left). */
  const end = (closing: boolean) => {
    if (ended) return

    ended = true
    clearInterval(keepalive)
    cleanup?.()
    if (closing) controller?.close()
  }

  const stream = new ReadableStream<Uint8Array>({
    start(opened) {
      controller = opened
      keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS)
      request.signal.addEventListener("abort", () => end(false))
      cleanup = start({
        send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        close: () => end(true),
      })
      // A source that ended the stream before it returned still gets its cleanup.
      if (ended) cleanup()
    },
    cancel: () => end(false),
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
