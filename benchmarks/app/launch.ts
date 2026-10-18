/** Starts the benchmark app as its own process on free ports, the way an environment launches an app. */
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

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
  const child = spawn(process.execPath, [SERVER], {
    env: { ...env, PORT: "0", WIDGET_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  })
  const port = await announcedPort(child.stdout)

  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return

      child.kill()
      await once(child, "exit")
    },
  }
}
