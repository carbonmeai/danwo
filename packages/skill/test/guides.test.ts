import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { guideIndex, installSkill, listGuides, readGuide, SKILL_FILE } from "../src/index.ts"

describe("danwo guide", () => {
  it("lists every guide with a title and summary, in order", () => {
    const guides = listGuides()

    expect(guides.map((g) => g.topic)).toEqual([
      "first-test",
      "locators-vs-agent",
      "matrix",
      "lint",
      "providers",
      "llm",
      "email-and-otp",
      "sessions",
      "secrets",
      "debugging",
      "dashboard",
      "ci",
      "playwright",
    ])
    expect(guides.every((g) => g.title !== "" && g.summary !== "")).toBe(true)
    expect(guideIndex()).toContain("matrix ")
  })

  it("prints one guide and refuses an unknown topic", () => {
    expect(readGuide("matrix")).toMatch(/^# Invariants and the fault matrix/)
    expect(() => readGuide("nope")).toThrow(/no guide "nope" \(guides: first-test/)
  })
})

describe("the shipped skill", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-skill-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("has frontmatter with a name and a description", async () => {
    const text = await readFile(SKILL_FILE, "utf8")

    expect(text).toMatch(/^---\nname: danwo\ndescription: .+\n---\n/)
  })

  it("installs into both agent folders, idempotently, and keeps a user's edits", async () => {
    expect(await installSkill(dir)).toEqual([
      { file: ".claude/skills/danwo/SKILL.md", outcome: "created" },
      { file: ".agents/skills/danwo/SKILL.md", outcome: "created" },
    ])
    expect((await installSkill(dir)).map((c) => c.outcome)).toEqual(["unchanged", "unchanged"])

    const edited = join(dir, ".claude/skills/danwo/SKILL.md")

    await writeFile(edited, "my own notes\n")
    expect((await installSkill(dir)).map((c) => c.outcome)).toEqual(["kept", "unchanged"])
    expect(await readFile(edited, "utf8")).toBe("my own notes\n")
  })

  it("updates a copy danwo wrote when the shipped skill changed", async () => {
    await installSkill(dir)

    const installed = join(dir, ".agents/skills/danwo/SKILL.md")
    const marker = join(dir, ".agents/skills/danwo/.danwo-skill.json")
    const older = "an older shipped version\n"
    const { createHash } = await import("node:crypto")

    await writeFile(installed, older)
    await writeFile(
      marker,
      JSON.stringify({ sha256: createHash("sha256").update(older).digest("hex") }),
    )

    expect((await installSkill(dir))[1]).toEqual({
      file: ".agents/skills/danwo/SKILL.md",
      outcome: "updated",
    })
    expect(await readFile(installed, "utf8")).toBe(await readFile(SKILL_FILE, "utf8"))
  })
})
