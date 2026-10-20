/**
 * A client run through the proxy (with its environment), the way an app's server would call:
 * `fetch <url>` prints the status, `text <url>` the status and body, `stream <url>` prints the first event of a stream and leaves it
 * open, `socket <url>` sends one frame and prints the echo, or the error when it is refused.
 * Node does not proxy WebSockets on its own, so the socket goes through a CONNECT tunnel, as a
 * browser's does.
 */
import { HttpsProxyAgent } from "https-proxy-agent"
import { type RawData, WebSocket } from "ws"

/** A frame's text, whichever form `ws` hands it over in. */
function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString()

  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString()
}

const [mode = "fetch", url = ""] = process.argv.slice(2)

async function fetchOnce(): Promise<void> {
  const response = await fetch(url)

  console.log(String(response.status))
}

async function streamOnce(): Promise<void> {
  const response = await fetch(url)
  const reader = response.body?.getReader()
  const first = await reader?.read()

  console.log(`${response.status} ${new TextDecoder().decode(first?.value).trim()}`)
  /* Keep the stream open a while, as an app listening for events would. */
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  await reader?.cancel()
}

async function socketOnce(): Promise<void> {
  await new Promise<void>((resolve) => {
    const socket = new WebSocket(url, { agent: new HttpsProxyAgent(process.env.HTTPS_PROXY ?? "") })

    socket.on("open", () => socket.send("ping"))
    socket.on("message", (data) => {
      console.log(`echo ${textOf(data)}`)
      socket.close(1000)
    })
    socket.on("close", () => resolve())
    socket.on("unexpected-response", (_request, response) => {
      console.log(`refused ${response.statusCode}`)
      resolve()
    })
    socket.on("error", (error) => {
      console.log(`error ${error.message}`)
      resolve()
    })
  })
}

const modes: Record<string, () => Promise<void>> = {
  fetch: fetchOnce,
  text: async () => {
    const response = await fetch(url)

    console.log(`${response.status} ${await response.text()}`)
  },
  stream: streamOnce,
  socket: socketOnce,
}

await (modes[mode] ?? fetchOnce)()
