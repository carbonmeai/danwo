/**
 * The project the dashboard shows: the example shop copied beside this suite, with one test it
 * cannot pass, after three runs. A run of the failing test alone comes first, so a test can delete
 * its recordings without touching the others; then a run of every test, and a matrix of the
 * purchase with the shop's webhook handler made to grant credits twice. The runs are the suite's
 * data, not a CI run of their own, so they take `--no-ci` and come out the same on a laptop and in
 * a CI job: no retry of the failing test, and a writable cache.
 */
import { execFile } from "node:child_process"
import { cp, mkdir, readdir, rm, symlink } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SHOP = fileURLToPath(new URL("../../../examples/shop/", import.meta.url))
const BROKEN = fileURLToPath(new URL("./fixture/broken.danwo.ts", import.meta.url))

/** The prepared project; git ignores it. */
export const PROJECT = fileURLToPath(new URL("./.work-project/", import.meta.url))

/** The `danwo` command this package installs. */
export const DANWO = join(
  dirname(createRequire(import.meta.url).resolve("@danwo/cli/package.json")),
  "bin",
  "danwo.mjs",
)

/** Runs `danwo` in the project; a run whose tests fail resolves too, with what it printed. */
function danwo(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [DANWO, ...args],
      { cwd: PROJECT, env: { ...process.env, NO_COLOR: "1", ...env }, maxBuffer: 16 << 20 },
      (_error, stdout, stderr) => resolve(`${stdout}${stderr}`),
    )
  })
}

/** Copies the shop into `PROJECT` with the failing test, and makes its runs. */
export async function prepareProject(): Promise<void> {
  await rm(PROJECT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await mkdir(PROJECT, { recursive: true })

  for (const entry of ["src", "tests", "danwo.config.ts", "package.json"])
    await cp(join(SHOP, entry), join(PROJECT, entry), { recursive: true })

  await symlink(join(SHOP, "node_modules"), join(PROJECT, "node_modules"), "junction")
  await cp(BROKEN, join(PROJECT, "tests", "broken.danwo.ts"))

  const output = [
    await danwo(["test", "tests/broken.danwo.ts", "--no-ci"]),
    await danwo(["test", "--no-ci"]),
    await danwo(
      ["matrix", "tests/buy-credits.danwo.ts", "--faults", "duplicate|status 500 on POST"],
      {
        SHOP_BUG: "no-dedupe",
      },
    ),
  ]
  const runs = await readdir(join(PROJECT, ".danwo", "runs")).catch(() => [])

  if (runs.length < 3)
    throw new Error(
      `the project has ${runs.length} runs, not 3; danwo printed:\n${output.join("\n")}`,
    )
}
