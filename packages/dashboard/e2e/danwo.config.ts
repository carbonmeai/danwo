/**
 * danwo tests its own dashboard: `danwo serve` over a project with real runs in it, driven the way
 * a person reads it. The runs are made fresh by each worker before the dashboard starts.
 */
import { defineConfig, freePort, startApp } from "@danwo/sdk"

import { DANWO, PROJECT, prepareProject } from "./project.ts"

export default defineConfig({
  testDir: "tests",
  /* The tests share one project on disk, and some add runs to it or delete one. */
  workers: 1,
  timeout: 90_000,
  async environment() {
    await prepareProject()

    const port = await freePort()
    const dashboard = await startApp(
      {
        command: `"${process.execPath}" "${DANWO}" serve --port ${port}`,
        url: `http://127.0.0.1:${port}/`,
        cwd: PROJECT,
      },
      { ...process.env, NO_COLOR: "1" },
    )

    return {
      baseUrl: dashboard.url,
      logs: () => ({ dashboard: dashboard.logs() }),
      stopped: () => {
        const exit = dashboard.exited()

        return exit === undefined ? [] : [`the dashboard ${exit}`]
      },
      close: () => dashboard.stop(),
    }
  },
})
