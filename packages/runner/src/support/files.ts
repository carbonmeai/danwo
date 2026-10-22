/** File operations that hold up on Windows, where an open file can't be replaced or removed. */
import { rename } from "node:fs/promises"

/** The errors Windows gives while another process (a worker, a scanner) holds a file open. */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"])

function isBusy(error: unknown): boolean {
  return error instanceof Error && "code" in error && BUSY.has(String(error.code))
}

/**
 * Renames `from` over `to`, retrying a few times while `to` is open elsewhere: elsewhere a rename
 * replaces an open file at once, on Windows it fails until the file is closed.
 */
export async function renameOver(
  from: string,
  to: string,
  move: (from: string, to: string) => Promise<void> = rename,
  attempts = 6,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await move(from, to)
    } catch (error) {
      if (attempt >= attempts || !isBusy(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt))
    }
  }
}
