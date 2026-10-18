/** Starts the shop's server as its own process, the way a test environment launches a backend. */
import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

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
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...env, PORT: "0" },
  })
  const port = await announcedPort(child.stdout)

  return { url: `http://127.0.0.1:${port}`, child, stop: () => stopShop(child) }
}

/** Ends the shop's process, if it still runs, and waits for it to go. */
async function stopShop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = once(child, "exit")

  child.kill()
  await exited
}
