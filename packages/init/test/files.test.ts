import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { type Answers, defaultAnswers } from "../src/answers.ts"
import { detectProject } from "../src/detect.ts"
import { lineDiff } from "../src/diff.ts"
import {
  conflicts,
  mergedPackageJson,
  planFiles,
  testScripts,
  withLines,
  writeFiles,
} from "../src/files.ts"
import { nextApp, project } from "./project.ts"

async function setUp(
  files: Readonly<Record<string, string | object>>,
  changes: Partial<Answers> = {},
) {
  const root = await project(files)
  const detection = await detectProject(root, {})
  const answers = { ...defaultAnswers(detection), ...changes }

  return { root, detection, answers }
}

const read = (root: string, file: string) => readFile(join(root, file), "utf8")

/** Whether a file already has exactly `line`. */
const has = (existing: readonly string[], line: string) => existing.includes(line)

describe("planFiles and writeFiles", () => {
  it("write the config, an example test, the script, .gitignore and .env.example", async () => {
    const { root, detection, answers } = await setUp({
      "package.json": nextApp(),
      ".gitignore": "node_modules\n",
    })
    const results = await writeFiles(root, await planFiles(answers, detection), false)

    expect(results.map((result) => [result.file, result.outcome])).toEqual([
      ["danwo.config.ts", "created"],
      ["tests/example.danwo.ts", "created"],
      ["package.json", "updated"],
      [".gitignore", "updated"],
      [".env.example", "created"],
    ])
    expect(JSON.parse(await read(root, "package.json")).scripts).toEqual({
      dev: "next dev",
      build: "next build",
      "test:danwo": "danwo test",
    })
    expect(await read(root, ".gitignore")).toBe("node_modules\n.danwo/\n")
    expect(await read(root, ".env.example")).toBe("AI_GATEWAY_API_KEY=\n")
  })

  it("change nothing when run again with the same answers", async () => {
    const { root, detection, answers } = await setUp({ "package.json": nextApp() })

    await writeFiles(root, await planFiles(answers, detection), false)

    const again = await writeFiles(root, await planFiles(answers, detection), false)

    expect(again.every((result) => result.outcome === "unchanged")).toBe(true)
  })

  it("keep an edited config unless told to replace it, and show what would change", async () => {
    const { root, detection, answers } = await setUp({
      "package.json": nextApp(),
      "danwo.config.ts": 'export default { testDir: "e2e" }\n',
    })
    const planned = await planFiles(answers, detection)

    expect(conflicts(planned).map((file) => file.file)).toEqual(["danwo.config.ts"])
    expect((await writeFiles(root, planned, false))[0]?.outcome).toBe("kept")
    expect(await read(root, "danwo.config.ts")).toContain("e2e")
    expect((await writeFiles(root, planned, true))[0]?.outcome).toBe("updated")
    expect(await read(root, "danwo.config.ts")).toContain("appEnvironment")
  })

  it("add no example where the project already has tests, and never overwrite one", async () => {
    const withTests = await setUp({ "package.json": nextApp(), "tests/checkout.danwo.ts": "" })
    const withExample = await setUp({
      "package.json": nextApp(),
      "tests/example.danwo.ts": "// mine\n",
    })

    expect(
      (await planFiles(withTests.answers, withTests.detection)).map((file) => file.file),
    ).not.toContain("tests/example.danwo.ts")

    const results = await writeFiles(
      withExample.root,
      await planFiles(withExample.answers, withExample.detection),
      true,
    )

    expect(results.find((result) => result.file === "tests/example.danwo.ts")?.outcome).toBe("kept")
    expect(await read(withExample.root, "tests/example.danwo.ts")).toBe("// mine\n")
  })

  it("write a config and test folder per engine for web and mobile", async () => {
    const { detection, answers } = await setUp({ "package.json": nextApp() }, { engine: "both" })
    const files = (await planFiles(answers, detection)).map((file) => file.file)

    expect(files).toEqual(
      expect.arrayContaining([
        "danwo.config.ts",
        "danwo.mobile.config.ts",
        "tests/web/example.danwo.ts",
        "tests/mobile/example.danwo.ts",
      ]),
    )
    expect(testScripts(answers)).toEqual({
      "test:danwo": "danwo test",
      "test:danwo:mobile": "danwo test --config danwo.mobile.config.ts",
    })
  })
})

describe("merging", () => {
  it("adds missing scripts to package.json, keeping its indent and its own scripts", () => {
    const before = '{\n\t"name": "a",\n\t"scripts": { "test:danwo": "mine" }\n}\n'

    expect(mergedPackageJson(before, "a", { "test:danwo": "danwo test" })).toBe(before)
    expect(mergedPackageJson('{\n    "name": "a"\n}\n', "a", { t: "danwo test" })).toBe(
      '{\n    "name": "a",\n    "scripts": {\n        "t": "danwo test"\n    }\n}\n',
    )
    expect(JSON.parse(mergedPackageJson(undefined, "new", { t: "x" }))).toEqual({
      name: "new",
      private: true,
      scripts: { t: "x" },
    })
    expect(() => mergedPackageJson("[]", "a", {})).toThrow("not a JSON object")
  })

  it("appends only the lines a file lacks", () => {
    expect(withLines("a\nb", ["b", "c"], has)).toBe("a\nb\nc\n")
    expect(withLines("a\n", ["a"], has)).toBe("a\n")
    expect(withLines(undefined, ["x"], has)).toBe("x\n")
  })
})

describe("lineDiff", () => {
  it("marks removed and added lines and folds unchanged runs", () => {
    const before = ["a", "b", "c", "d", "e", "f"].join("\n")
    const after = ["a", "b", "c", "D", "e", "f"].join("\n")

    expect(lineDiff(before, after)).toBe(
      ["  … 2 unchanged", "  c", "- d", "+ D", "  e", "  … 1 unchanged"].join("\n"),
    )
  })
})
