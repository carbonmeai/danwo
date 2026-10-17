import { type ChildProcess, spawn } from "node:child_process"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"

import { defineConfig, googleEnvironment } from "@danwo/sdk"

const APP = fileURLToPath(new URL("./app.mjs", import.meta.url))

/** A free local port, so the redirect URI can be registered before the app starts. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address()

      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

/** Starts the app on `port` with `env`; resolves once it listens. */
async function launch(port: number, env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  const child = spawn(process.execPath, [APP], {
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

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const google = await googleEnvironment({
      seed: {
        users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }],
        oauth_clients: [
          {
            client_id: "123-danwo.apps.googleusercontent.com",
            client_secret: "GOCSPX-danwo-fixture",
            name: "Danwo Fixture",
            redirect_uris: [`http://127.0.0.1:${port}/auth/google/callback`],
          },
        ],
      },
    })
    let app = await launch(port, google.proxy.env())

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: google.proxy,
      fixtures: google.fixtures,
      async reset() {
        app.kill()
        await google.reset()
        app = await launch(port, google.proxy.env())
      },
      async close() {
        app.kill()
        await google.close()
      },
    }
  },
})
