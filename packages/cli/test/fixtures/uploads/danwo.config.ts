import { type ChildProcess, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { defineConfig, s3Environment } from "@danwo/sdk"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

/** Starts the uploads app on a free port with `env`; resolves to its URL and process. */
async function launch(env: NodeJS.ProcessEnv): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [APP], { env, stdio: ["ignore", "pipe", "inherit"] })
  const port = await new Promise<string>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      const match = /listening (\d+)/.exec(chunk.toString())

      if (match?.[1]) resolve(match[1])
    })
    child.once("exit", (code) => reject(new Error(`app exited with ${code}`)))
  })

  return { url: `http://127.0.0.1:${port}`, child }
}

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  // S3 only: no service delivers webhooks, so `danwo matrix` plans outbound faults alone.
  async environment() {
    const s3 = await s3Environment({ seed: { buckets: [{ name: "danwo-uploads" }] } })
    let app = await launch(s3.proxy.env())

    return {
      get baseUrl() {
        return app.url
      },
      proxy: s3.proxy,
      fixtures: s3.fixtures,
      async reset() {
        app.child.kill()
        await s3.reset()
        app = await launch(s3.proxy.env())
      },
      async close() {
        app.child.kill()
        await s3.close()
      },
    }
  },
})
