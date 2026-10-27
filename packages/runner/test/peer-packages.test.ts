import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { codeOf } from "../src/support/codes.ts"
import { checkPeers, missingPeers } from "../src/support/peer-packages.ts"

const root = mkdtempSync(join(tmpdir(), "danwo-peers-"))

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

/** A project under the test's root holding `files`, each path relative to it. */
function project(name: string, files: Readonly<Record<string, string>>): string {
  const dir = join(root, name)

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }

  return dir
}

/** A package at `path` (a name, or a path ending in `node_modules/<name>`), as installed. */
const installed = (path: string) => ({
  [`${path.includes("node_modules/") ? path : `node_modules/${path}`}/package.json`]: "{}",
})

const CONFIG = `import { stackEnvironment } from "@danwo/sdk"
import { databases } from "./stack/data.ts"
export default { environment: () => stackEnvironment({ services: [tiptapService()] }) }
`

describe("packages a config's features need", () => {
  it("names every feature whose packages are missing, across the config and its local imports", () => {
    const dir = project("both", {
      "danwo.config.ts": CONFIG,
      "stack/data.ts": "export const databases = [postgresSnapshot(url)]",
      ...installed("yjs"),
    })

    expect(missingPeers(join(dir, "danwo.config.ts"), dir)).toEqual([
      { feature: "the Tiptap emulator", packages: ["y-protocols"] },
      { feature: "Postgres snapshots", packages: ["pg"] },
    ])
  })

  it("fails before any test with one command that adds them all, in the project's manager", () => {
    const dir = project("pnpm", {
      "danwo.config.ts": CONFIG,
      "stack/data.ts": "postgresSnapshot(url)",
      "pnpm-lock.yaml": "",
    })
    let thrown: unknown

    try {
      checkPeers({ path: join(dir, "danwo.config.ts"), root: dir })
    } catch (error) {
      thrown = error
    }

    expect(codeOf(thrown)).toBe("PACKAGE_MISSING")
    expect(String(thrown)).toContain(
      "the config uses the Tiptap emulator (yjs, y-protocols) and Postgres snapshots (pg)",
    )
    expect(String(thrown)).toMatch(/pnpm add -D yjs y-protocols pg$/)
  })

  it("passes a config whose packages are installed, one installed further up, or one that uses none", () => {
    const dir = project("installed", {
      "app/danwo.config.ts": CONFIG,
      "app/stack/data.ts": "",
      ...installed("yjs"),
      ...installed("y-protocols"),
    })
    const plain = project("plain", { "danwo.config.ts": "export default {} // tiptap, pg" })

    expect(() =>
      checkPeers({ path: join(dir, "app/danwo.config.ts"), root: join(dir, "app") }),
    ).not.toThrow()
    expect(() => checkPeers({ path: join(plain, "danwo.config.ts"), root: plain })).not.toThrow()
    expect(() => checkPeers({ root: plain })).not.toThrow()
  })

  it("finds the packages where the danwo package that loads them has them, as in a linked checkout", () => {
    const checkout = project("checkout", {
      "packages/emulators/package.json": "{}",
      ...installed("packages/emulators/node_modules/yjs"),
      ...installed("packages/emulators/node_modules/y-protocols"),
    })
    const dir = project("linked", { "danwo.config.ts": CONFIG, "stack/data.ts": "" })

    mkdirSync(join(dir, "node_modules/@danwo"), { recursive: true })
    symlinkSync(
      join(checkout, "packages/emulators"),
      join(dir, "node_modules/@danwo/emulators"),
      "junction",
    )

    expect(missingPeers(join(dir, "danwo.config.ts"), dir)).toEqual([])
  })
})
