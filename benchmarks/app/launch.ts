/** Starts the benchmark app as its own process on free ports, the way an environment launches an app. */
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { spawnOwned } from "@danwo/sdk"

const SERVER = fileURLToPath(new URL("./server.ts", import.meta.url))

export interface BenchApp {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string
  stop(): Promise<void>
}

/** The port the app prints once it listens, read line by line from its output. */
async function announcedPort(output: NodeJS.ReadableStream): Promise<string> {
  for await (const line of createInterface({ input: output })) {
    const port = /^listening (\d+)$/.exec(line)?.[1]

    if (port !== undefined) return port
  }

  throw new Error("the benchmark app stopped before it was listening")
}

export async function launchBenchApp(env: NodeJS.ProcessEnv): Promise<BenchApp> {
  /* Owned by danwo: stopped with the run even if it ends without calling stop(). */
  const owned = spawnOwned(process.execPath, [SERVER], {
    env: { ...env, PORT: "0", WIDGET_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  })

  if (owned.child.stdout === null) throw new Error("the benchmark app's output is not piped")

  const port = await announcedPort(owned.child.stdout)

  return { url: `http://127.0.0.1:${port}`, stop: () => owned.stop() }
}
