import { describe, expect, it } from "vitest"

import { snippetOf } from "../src/nylas/helpers.ts"

/** How long `run` takes, in milliseconds. */
function timed(run: () => unknown): number {
  const started = performance.now()

  run()

  return performance.now() - started
}

describe("a Nylas message's snippet", () => {
  it("is the HTML's text", () => {
    expect(snippetOf("<p>Hello <b>Ada</b></p>")).toBe("Hello Ada")
  })

  it("takes time in step with a body of many <", () => {
    expect(timed(() => snippetOf("<".repeat(100_000)))).toBeLessThan(500)
  })
})
