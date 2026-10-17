/**
 * `danwo-playwright matrix <spec> [--grep <re>] [--faults <re>] [--config <file>]
 * [--danwo-config <file>]`: the fault matrix over one Playwright test.
 */
import { parseArgs } from "node:util"

import { runPlaywrightMatrix } from "./matrix.ts"

const USAGE =
  "usage: danwo-playwright matrix <spec> [--grep <re>] [--faults <re>] [--config <file>] [--danwo-config <file>]"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    grep: { type: "string" },
    faults: { type: "string" },
    config: { type: "string" },
    "danwo-config": { type: "string" },
  },
})
const [command, spec] = positionals

if (command !== "matrix" || spec === undefined) {
  process.stderr.write(`${USAGE}\n`)
  process.exitCode = 2
} else {
  process.exitCode = await runPlaywrightMatrix({
    spec,
    grep: values.grep,
    faults: values.faults,
    config: values.config,
    danwoConfig: values["danwo-config"],
  })
}
