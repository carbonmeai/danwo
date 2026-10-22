/**
 * Whether anything listens on a port of this machine. A request passed through to a loopback port
 * nobody listens on is refused, and the proxy would otherwise report it in terms of its own
 * plumbing; asking first lets it say plainly that the service the app wants is not running.
 */
import { connect } from "node:net"

const PROBE_TIMEOUT_MS = 500
/** How long an answer is reused: a port that starts listening is seen within a quarter second. */
const REMEMBER_MS = 250
/**
 * How long Windows' "nothing listens" is reused. Windows retries a refused loopback connection
 * instead of failing it, so each probe of a closed port (`::1` for an app on 127.0.0.1 only) waits
 * out the whole timeout; asking less often keeps that off most requests.
 */
const WINDOWS_CLOSED_MS = 2_000

/** How long an answer about a port is reused on `platform`. */
export function rememberFor(
  listening: boolean,
  platform: NodeJS.Platform = process.platform,
): number {
  return !listening && platform === "win32" ? WINDOWS_CLOSED_MS : REMEMBER_MS
}

const remembered = new Map<string, { readonly listening: boolean; readonly at: number }>()

/** True when a TCP connection to `host:port` is accepted. */
function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })

    const done = (listening: boolean) => {
      socket.destroy()
      resolve(listening)
    }

    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

/** Whether `host:port` accepts connections, asked at most once a quarter second. */
export async function isListening(host: string, port: number): Promise<boolean> {
  const bare = host.startsWith("[") ? host.slice(1, -1) : host
  const key = `${bare}:${port}`
  const known = remembered.get(key)

  if (known && Date.now() - known.at < rememberFor(known.listening)) return known.listening

  const listening = await probe(bare, port)

  remembered.set(key, { listening, at: Date.now() })

  return listening
}

/** The answer for a request to a port of this machine that nothing listens on. */
export function nothingListening(host: string, port: number): string {
  return `danwo proxy: nothing is listening on ${host}:${port}; start that service or route the host`
}
