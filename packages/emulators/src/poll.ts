import { setTimeout as sleep } from "node:timers/promises"

/** How often a waiting test helper looks again. */
const POLL_MS = 50

/**
 * The first value `find` returns within `timeoutMs`, looking again every 50 ms; throws `failure`
 * when nothing turned up. Inbox helpers wait for mail and texts the app is still sending this way.
 */
export async function waitUntil<T>(
  find: () => T | undefined,
  timeoutMs: number,
  failure: string,
): Promise<T> {
  const giveUpAt = Date.now() + timeoutMs

  while (Date.now() <= giveUpAt) {
    const found = find()

    if (found !== undefined) return found
    await sleep(POLL_MS)
  }

  throw new Error(failure)
}
