/** Waiting for a program danwo runs beside a device (a screen recorder) to finish. */
import type { ChildProcess } from "node:child_process"

/** Resolves once `child` has exited, or after `ms`. */
export function exited(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)

    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
