import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { drift, KIT_DIR, KIT_FILES, kitTargets, sync } from "../../examples/_kit/sync.ts"
import { linkedManifest, tarballsIn } from "../../examples/link.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A throwaway `examples/` folder with a kit and the examples named, each with a package.json. */
function examplesWith(names: readonly string[]): { root: string; kit: string } {
  const root = mkdtempSync(join(tmpdir(), "danwo-examples-"))
  const kit = join(root, "_kit")

  made.push(root)
  mkdirSync(kit)
  for (const file of KIT_FILES) writeFileSync(join(kit, file), `/* ${file} */\n`)

  for (const name of names) {
    mkdirSync(join(root, name))
    writeFileSync(join(root, name, "package.json"), "{}\n")
  }

  return { root, kit }
}

describe("the examples' kit", () => {
  it("is copied unchanged into every example that uses it", () => {
    expect(kitTargets()).toContain("with-next")
    expect(drift()).toEqual([])
  })

  it("finds a copy that was edited, is missing a file or holds one the kit lacks", () => {
    const { root, kit } = examplesWith(["with-a", "with-b"])

    sync(["with-a", "with-b"], root, kit)
    writeFileSync(join(root, "with-a", "kit", "kit.css"), "/* edited */\n")
    rmSync(join(root, "with-b", "kit", "tailwind.css"))
    writeFileSync(join(root, "with-b", "kit", "extra.css"), "")

    expect(drift(root, kit)).toEqual([
      { example: "with-a", file: "kit.css", problem: "different" },
      { example: "with-b", file: "tailwind.css", problem: "missing" },
      { example: "with-b", file: "extra.css", problem: "extra" },
    ])
  })

  it("syncs the examples that have a copy, and starts one where asked", () => {
    const { root, kit } = examplesWith(["with-a", "with-b"])

    mkdirSync(join(root, "with-a", "kit"))

    expect(sync([], root, kit)).toEqual([
      "examples/with-a/kit/kit.css",
      "examples/with-a/kit/tailwind.css",
    ])
    expect(sync(["with-b"], root, kit)).toHaveLength(4)
    expect(readFileSync(join(root, "with-b", "kit", "kit.css"), "utf8")).toBe("/* kit.css */\n")
    expect(() => sync(["nothing"], root, kit)).toThrow("has no package.json")
  })

  it("ships both the plain-CSS kit and its Tailwind theme", () => {
    expect(KIT_FILES).toEqual(["kit.css", "tailwind.css"])
    expect(readFileSync(join(KIT_DIR, "tailwind.css"), "utf8")).toContain("@theme inline")
  })
})

describe("linking an example to the release tarballs", () => {
  const tarballs = [
    { name: "@danwo/cli", version: "0.1.0-beta.0", file: "/r/danwo-cli-0.1.0-beta.0.tgz" },
    { name: "@danwo/runner", version: "0.1.0-beta.0", file: "/r/danwo-runner-0.1.0-beta.0.tgz" },
    { name: "@danwo/sdk", version: "0.1.0-beta.0", file: "/r/danwo-sdk-0.1.0-beta.0.tgz" },
  ]

  it("reads each tarball's package and version from its file name", () => {
    const dir = mkdtempSync(join(tmpdir(), "danwo-tarballs-"))

    made.push(dir)
    for (const file of ["danwo-cli-0.1.0-beta.0.tgz", "danwo-dashboard-1.2.3.tgz", "notes.txt"])
      writeFileSync(join(dir, file), "")

    expect(tarballsIn(dir).map(({ name, version }) => `${name}@${version}`)).toEqual([
      "@danwo/cli@0.1.0-beta.0",
      "@danwo/dashboard@1.2.3",
    ])
  })

  it("installs danwo's packages, and the ones they need, from the tarballs", () => {
    const linked = linkedManifest(
      {
        name: "example",
        dependencies: { next: "16.4.2" },
        devDependencies: { "@danwo/cli": "0.1.0-beta.0", "@danwo/sdk": "0.1.0-beta.0" },
      },
      tarballs,
    )

    expect(linked).toEqual({
      name: "example",
      dependencies: { next: "16.4.2" },
      devDependencies: {
        "@danwo/cli": "file:/r/danwo-cli-0.1.0-beta.0.tgz",
        "@danwo/sdk": "file:/r/danwo-sdk-0.1.0-beta.0.tgz",
      },
      overrides: {
        "@danwo/cli": "file:/r/danwo-cli-0.1.0-beta.0.tgz",
        "@danwo/runner": "file:/r/danwo-runner-0.1.0-beta.0.tgz",
        "@danwo/sdk": "file:/r/danwo-sdk-0.1.0-beta.0.tgz",
      },
    })
  })

  it("refuses an example that pins another version, or a package with no tarball", () => {
    expect(() => linkedManifest({ devDependencies: { "@danwo/cli": "0.2.0" } }, tarballs)).toThrow(
      "pins @danwo/cli@0.2.0",
    )
    expect(() =>
      linkedManifest({ devDependencies: { "@danwo/mcp": "0.1.0-beta.0" } }, tarballs),
    ).toThrow("no tarball holds @danwo/mcp")
  })
})

/** Whether a workspace glob such as `examples/shop*` matches `path`. */
function matches(pattern: string, path: string): boolean {
  return new RegExp(`^${pattern.replaceAll("*", "[^/]*")}$`).test(path)
}

/** The examples whose `example.json` says how they install: `npm` (standalone) or `workspace`. */
function examplesBy(install: "npm" | "workspace"): string[] {
  const root = join(ROOT, "examples")

  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, "example.json")))
    .filter((name) => {
      const notes: unknown = JSON.parse(readFileSync(join(root, name, "example.json"), "utf8"))

      return Reflect.get(Object(notes), "install") === install
    })
    .toSorted()
}

/** A JSON config's string list at `key`, e.g. `.oxlintrc.json`'s `ignorePatterns`. */
function listIn(file: string, key: string): string[] {
  const config: unknown = JSON.parse(readFileSync(join(ROOT, file), "utf8"))
  const list: unknown = Reflect.get(Object(config), key)

  return Array.isArray(list) ? list.map(String) : []
}

/** Whether a glob with `*` and `[!…]` classes, such as `examples/s[!h]*`, matches `path`. */
function globMatches(pattern: string, path: string): boolean {
  const source = pattern
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("[!", "[^")
    .replaceAll("\0", ".*")

  return new RegExp(`^${source}$`).test(path)
}

describe("the standalone examples", () => {
  const standalone = examplesBy("npm")

  it("are not workspaces of the repository", () => {
    const root: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    const workspaces: unknown = Reflect.get(Object(root), "workspaces")
    const patterns = Array.isArray(workspaces) ? workspaces.map(String) : []

    expect(standalone).toEqual(expect.arrayContaining(["commerce", "with-next"]))
    for (const name of standalone)
      expect(patterns.filter((pattern) => matches(pattern, `examples/${name}`))).toEqual([])
  })

  it("are left to their own toolchain: the repository's lint and fallow skip them", () => {
    for (const file of [".oxlintrc.json", ".fallowrc.json"]) {
      const ignored = listIn(file, "ignorePatterns")

      for (const name of standalone)
        expect(
          ignored.some((pattern) => globMatches(pattern, `examples/${name}/app.ts`)),
          `${file} ignores examples/${name}`,
        ).toBe(true)
      for (const name of examplesBy("workspace"))
        expect(
          ignored.some((pattern) => globMatches(pattern, `examples/${name}/src/app.ts`)),
          `${file} lints examples/${name}`,
        ).toBe(false)
    }
  })

  it("commit no lockfile", () => {
    /* What git holds or would add: tracked files, and untracked ones no .gitignore leaves out. */
    const tracked = execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        ...standalone.map((name) => `examples/${name}`),
      ],
      { cwd: ROOT, encoding: "utf8" },
    )

    expect(
      tracked
        .split("\n")
        .filter((path) =>
          /(package-lock\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)$/.test(path),
        ),
    ).toEqual([])
  })
})
