/**
 * Fails when the repository has a JavaScript file outside the few that must stay JavaScript.
 * Everything else is TypeScript, so it is type-checked and linted.
 *
 * The exceptions load before any TypeScript can: the `danwo` and `danwo-playwright` commands'
 * entry points, the hook that strips types from danwo's own installed source, and the preload
 * injected into the app under test.
 */
import { execFileSync } from "node:child_process"

const ALLOWED = new Set([
  "packages/cli/bin/danwo.mjs",
  "packages/playwright/bin/danwo-playwright.mjs",
  "packages/runner/strip-types.mjs",
  "packages/proxy/preload.mjs",
])

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
}).split("\n")
const unexpected = files.filter((file) => /\.[cm]?js$/.test(file) && !ALLOWED.has(file))

if (unexpected.length > 0) {
  console.error(`JavaScript files found; write these in TypeScript:\n  ${unexpected.join("\n  ")}`)
  process.exitCode = 1
}
