/**
 * danwo tests its own dashboard: `danwo serve` over a project with real runs in it, driven the way
 * a person reads it. The runs are made fresh by each worker before the dashboard starts.
 */
import { appEnvironment, defineConfig, freePort } from "@danwo/sdk"

import { DANWO, PROJECT, prepareProject } from "./project.ts"

export default defineConfig({
  /* The repository has two suites; GitHub reports each under its name. */
  name: "dashboard",
  testDir: "tests",
  /* The tests share one project on disk, and some add runs to it or delete one. */
  workers: 1,
  timeout: 90_000,
  async environment() {
    await prepareProject()

    const port = await freePort()

    /* The dashboard runs danwo itself (a run from its page), which must not inherit a proxy. */
    return appEnvironment({
      app: {
        command: `"${process.execPath}" "${DANWO}" serve --port ${port}`,
        url: `http://127.0.0.1:${port}/`,
        cwd: PROJECT,
        env: { NO_COLOR: "1" },
      },
      proxy: false,
    })
  },
})
