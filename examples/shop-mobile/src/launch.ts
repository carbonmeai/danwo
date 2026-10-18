/** Starts the shop's server as its own process, the way a test environment launches a backend. */
import { type ChildProcess, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

const SERVER = fileURLToPath(new URL("./server.ts", import.meta.url))

export interface Shop {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string
  readonly child: ChildProcess
  stop(): Promise<void>
}

/** The port the server announces on its first `listening <port>` line. */
async function announcedPort(child: ChildProcess): Promise<string> {
  if (child.stdout === null) throw new Error("the shop's output is not piped")

  for await (const line of createInterface({ input: child.stdout })) {
    const port = /^listening (\d+)$/.exec(line)?.[1]

    if (port !== undefined) return port
  }

  throw new Error(`the shop stopped before listening (exit ${String(child.exitCode)})`)
}

/** The shop on a free port, once it is listening. */
export async function launchShop(env: NodeJS.ProcessEnv): Promise<Shop> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  })
  const port = await announcedPort(child)

  return {
    url: `http://127.0.0.1:${port}`,
    child,
    async stop() {
      if (child.exitCode !== null) return

      const exited = new Promise((resolve) => child.once("exit", resolve))

      child.kill()
      await exited
    },
  }
}
