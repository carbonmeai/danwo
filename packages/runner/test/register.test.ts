import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

const HOOK = new URL("../src/runner/register.ts", import.meta.url).href
const root = mkdtempSync(join(tmpdir(), "danwo-register-"))

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

/** A project whose package.json has `type`, with a config importing a helper by an extensionless path. */
function project(name: string, type: string | undefined): string {
  const dir = join(root, name)

  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...(type && { type }) }))
  writeFileSync(join(dir, "helper.ts"), "export const answer: number = 42\n")
  writeFileSync(
    join(dir, "danwo.config.ts"),
    'import { answer } from "./helper"\n\nconsole.log(`answer ${answer}`)\n',
  )

  return dir
}

/** Runs the project's config under Node with the hook, as a danwo process loads it. */
function load(dir: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", HOOK, join(dir, "danwo.config.ts")],
      { cwd: dir },
      (error, stdout, stderr) => resolve(error === null ? stdout.trim() : stderr),
    )
  })
}

describe("the TypeScript hook every danwo process loads", () => {
  it("loads a project's .ts files as ES modules whatever its package.json says", async () => {
    expect(await load(project("esm", "module"))).toBe("answer 42")
    expect(await load(project("cjs", "commonjs"))).toBe("answer 42")
    expect(await load(project("untyped", undefined))).toBe("answer 42")
  })
})
