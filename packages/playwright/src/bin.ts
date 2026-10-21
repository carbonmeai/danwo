/**
 * `danwo-playwright matrix <spec> [--grep <re>] [--faults <re>] [--config <file>]
 * [--danwo-config <file>]`: the fault matrix over one Playwright test.
 */
import { parseArgs } from "node:util"

import { runPlaywrightMatrix } from "./matrix.ts"

const USAGE =
  "usage: danwo-playwright matrix <spec> [--grep <re>] [--faults <re>] [--config <file>] [--danwo-config <file>]"

/** The command line, or undefined when it has an option the command does not take. */
function parsed() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        grep: { type: "string" },
        faults: { type: "string" },
        config: { type: "string" },
        "danwo-config": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    })
  } catch (error) {
    process.stderr.write(
      `danwo-playwright: ${error instanceof Error ? error.message : String(error)}\n`,
    )

    return undefined
  }
}

const args = parsed()
const { values = {}, positionals = [] } = args ?? {}
const [command, spec] = positionals

if (values.help === true) {
  process.stdout.write(`${USAGE}\n`)
} else if (args === undefined || command !== "matrix" || spec === undefined) {
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
