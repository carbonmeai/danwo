import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { test } from "@danwo/sdk"

import { log } from "./log.ts"

test("passes on its third attempt", { retries: 2 }, ({ expect }) => {
  const counter = join(process.env.DANWO_FIXTURE_STATE ?? ".", "retries")
  const attempt = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1

  writeFileSync(counter, String(attempt))
  log(`retries attempt ${attempt}`)
  expect(attempt).toBe(3)
})
