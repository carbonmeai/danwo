import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

const INDEX = new URL("../src/index.ts", import.meta.url).href

/**
 * Runs `body` in a fresh Node where `yjs`, `y-protocols` and `lib0` cannot be found, as in a
 * project without Tiptap, after importing the emulators as `emulators`.
 */
function withoutYjs(body: string) {
  const script = `
    import { registerHooks } from "node:module"

    registerHooks({
      resolve(specifier, context, next) {
        const name = /^(yjs|y-protocols|lib0)(\\/|$)/.exec(specifier)?.[1]

        if (name === undefined) return next(specifier, context)

        const error = new Error(\`Cannot find package '\${name}' imported from \${context.parentURL}\`)

        error.code = "ERR_MODULE_NOT_FOUND"
        throw error
      },
    })

    const emulators = await import(${JSON.stringify(INDEX)})
    ${body}
  `

  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" })
}

describe("the Tiptap emulator in a project without Yjs", () => {
  it("leaves every other emulator working", () => {
    const run = withoutYjs(`
      const stripe = emulators.createEmulator(emulators.stripe)
      console.log(typeof stripe.store)
    `)

    expect(run.stderr).not.toContain("Error")
    expect(run.stdout.trim()).toBe("object")
  })

  it("says to install yjs and y-protocols when a test uses it", () => {
    const run = withoutYjs(`
      try {
        emulators.createEmulator(emulators.tiptap)
      } catch (error) {
        console.log(error.message)
      }
    `)

    expect(run.stdout.trim()).toMatch(
      /^the Tiptap emulator needs yjs and y-protocols, as Tiptap's collaboration does: npm install -D yjs y-protocols \(Node found no (yjs|y-protocols|lib0)\)$/,
    )
  })
})
