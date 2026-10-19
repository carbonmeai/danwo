/** Helpers the fixtures' configs share to run their app as a child process. */
import type { ChildProcess } from "node:child_process"
import { createServer } from "node:net"

import { spawnOwned } from "@danwo/sdk"

/** A free local port, so URLs that point at the app can be seeded before it starts. */
export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address()

      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

/**
 * Starts the app at `path` on `port` with `env`; resolves once it prints "listening". The run owns
 * it, so it ends with the worker even when a config never kills it.
 */
export async function launchApp(
  path: string,
  port: number,
  env: NodeJS.ProcessEnv,
): Promise<ChildProcess> {
  const { child } = spawnOwned(process.execPath, [path], {
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  })

  await new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening")) resolve()
    })
    child.once("exit", (code) => reject(new Error(`app exited with ${code}`)))
  })

  return child
}
