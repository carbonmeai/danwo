// Starts the shop as its own process on a free port, the way a test environment launches an app.
import type { ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"

import { spawnOwned } from "@danwo/sdk"

const SERVER = fileURLToPath(new URL("./server.ts", import.meta.url))

export interface Shop {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string
  readonly child: ChildProcess
  stop(): Promise<void>
}

export async function launchShop(env: NodeJS.ProcessEnv): Promise<Shop> {
  /* Owned by danwo: stopped with the run even if it ends without calling stop(). */
  const owned = spawnOwned(process.execPath, [SERVER], {
    env: { ...env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  })
  const { child } = owned
  const port = await new Promise<string>((resolve, reject) => {
    let out = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString()

      const match = /listening (\d+)/.exec(out)

      if (match?.[1]) {
        resolve(match[1])
      }
    })
    child.once("exit", (code) => reject(new Error(`shop exited with ${code}`)))
  })

  return {
    url: `http://127.0.0.1:${port}`,
    child,
    stop: () => owned.stop(),
  }
}
