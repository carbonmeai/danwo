/**
 * danwo tests its own website: the built, prerendered site under Vite's preview server, on a port
 * of its own. Build it first (`bun run build`); `bun run test:e2e` does both.
 */
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { defineConfig, freePort, startApp } from "@danwo/sdk"

const WEBSITE = fileURLToPath(new URL("..", import.meta.url))
const BUILT = fileURLToPath(new URL("../dist/client/index.html", import.meta.url))

export default defineConfig({
  testDir: "tests",
  workers: 2,
  async environment() {
    if (!existsSync(BUILT))
      throw new Error(`the website is not built (no ${BUILT}): run \`bun run build\` in website/`)

    const port = await freePort()
    const site = await startApp(
      {
        command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
        url: `http://127.0.0.1:${port}/`,
        cwd: WEBSITE,
      },
      process.env,
    )

    return {
      baseUrl: site.url,
      logs: () => ({ preview: site.logs() }),
      close: () => site.stop(),
    }
  },
})
