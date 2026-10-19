/** Starts the shop's server as its own process, the way a test environment launches a backend. */
import type { ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

import { spawnOwned } from "@danwo/sdk"

const SERVER = fileURLToPath(new URL("./server.ts", import.meta.url))

export interface Shop {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string
  readonly child: ChildProcess
  stop(): Promise<void>
}

/** The port the server announces on its first `listening <port>` line of `output`. */
async function announcedPort(output: Readable): Promise<string> {
  for await (const line of createInterface({ input: output })) {
    const port = /^listening (\d+)$/.exec(line)?.[1]

    if (port !== undefined) return port
  }

  throw new Error("the shop stopped before listening")
}

/** The shop on a free port, once it is listening. */
export async function launchShop(env: NodeJS.ProcessEnv): Promise<Shop> {
  /* PORT 0: the server picks a free port and prints it. */
  /* Owned by danwo: stopped with the run even if it ends without calling stop(). */
  const owned = spawnOwned(process.execPath, [SERVER], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...env, PORT: "0" },
  })
  const { child } = owned

  if (child.stdout === null) throw new Error("the shop's output is not piped")

  const port = await announcedPort(child.stdout)

  return { url: `http://127.0.0.1:${port}`, child, stop: () => owned.stop() }
}
