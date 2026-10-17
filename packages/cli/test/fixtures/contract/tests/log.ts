/*
 * Tests in this fixture append to one log in the run's state directory, so the CLI test can
 * check what ran and in what order.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"

export function log(line: string): void {
  appendFileSync(join(process.env.DANWO_FIXTURE_STATE ?? ".", "run.log"), `${line}\n`)
}
