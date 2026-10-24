import { describe, expect, test } from "vitest"

import {
  distTag,
  formatSize,
  isSemver,
  type Manifest,
  packedTarball,
  parseReleaseArgs,
  processesUnder,
  publicPackages,
  publishOrder,
  refusals,
  releasedRange,
  stagedManifest,
  stepReport,
  summaryLines,
  type WorkspacePackage,
} from "../release-plan.ts"

const VERSION = "0.1.0-beta.0"

/** A package in folder `folder` named `@danwo/<folder>`, with runtime dependencies on `deps`. */
function workspace(folder: string, deps: readonly string[] = [], extra: Partial<Manifest> = {}) {
  const manifest: Manifest = {
    name: `@danwo/${folder}`,
    version: "0.0.0",
    private: true,
    dependencies: Object.fromEntries(deps.map((dep) => [`@danwo/${dep}`, "workspace:*"])),
    ...extra,
  }

  return { folder, manifest } satisfies WorkspacePackage
}

describe("parseReleaseArgs", () => {
  test("packs by default, into dist/release", () => {
    expect(parseReleaseArgs([VERSION])).toEqual({
      version: VERSION,
      mode: "pack",
      verify: false,
      out: "dist/release",
    })
  })

  test("reads --publish, --verify and --out", () => {
    expect(parseReleaseArgs(["1.0.0", "--publish", "--verify", "--out", "tarballs"])).toEqual({
      version: "1.0.0",
      mode: "publish",
      verify: true,
      out: "tarballs",
    })
  })

  test("refuses no version, two versions, both modes and unknown flags", () => {
    expect(() => parseReleaseArgs([])).toThrow("usage:")
    expect(() => parseReleaseArgs(["1.0.0", "1.0.1"])).toThrow("usage:")
    expect(() => parseReleaseArgs(["1.0.0", "--pack", "--publish"])).toThrow("exclude each other")
    expect(() => parseReleaseArgs(["1.0.0", "--force"])).toThrow("--force")
  })
})

describe("versions", () => {
  test("accepts semantic versions and refuses the rest", () => {
    for (const version of ["0.1.0", VERSION, "1.2.3-rc.1+build.5", "10.20.30"])
      expect(isSemver(version)).toBe(true)
    for (const version of ["v1.0.0", "1.0", "01.0.0", "1.0.0-", "1.0.0-beta..1", "latest"])
      expect(isSemver(version)).toBe(false)
  })

  test("publishes a prerelease under beta and a release under latest", () => {
    expect(distTag(VERSION)).toBe("beta")
    expect(distTag("1.0.0+build.1")).toBe("latest")
    expect(distTag("1.0.0")).toBe("latest")
  })
})

describe("staging", () => {
  test("rewrites every workspace range to the version, leaving other ranges alone", () => {
    expect(releasedRange("workspace:*", VERSION)).toBe(VERSION)
    expect(releasedRange("workspace:^", VERSION)).toBe(`^${VERSION}`)
    expect(releasedRange("workspace:~", VERSION)).toBe(`~${VERSION}`)
    expect(releasedRange("workspace:1.2.3", VERSION)).toBe("1.2.3")
    expect(releasedRange("^24", VERSION)).toBe("^24")
  })

  test("sets the version, drops private and keeps every other field", () => {
    const manifest: Manifest = {
      name: "@danwo/cli",
      version: "0.0.0",
      private: true,
      bin: { danwo: "./bin/danwo.mjs" },
      dependencies: { "@danwo/runner": "workspace:*", "@clack/prompts": "1.8.1" },
      peerDependencies: { "@danwo/sdk": "workspace:^" },
      devDependencies: { "@danwo/fidelity": "workspace:*" },
    }
    const staged = stagedManifest(manifest, VERSION)

    expect(staged).toEqual({
      name: "@danwo/cli",
      version: VERSION,
      bin: { danwo: "./bin/danwo.mjs" },
      dependencies: { "@danwo/runner": VERSION, "@clack/prompts": "1.8.1" },
      peerDependencies: { "@danwo/sdk": `^${VERSION}` },
      devDependencies: { "@danwo/fidelity": VERSION },
    })
    expect("private" in staged).toBe(false)
    expect(JSON.stringify(staged)).not.toContain("workspace:")
    expect(manifest.version).toBe("0.0.0")
  })

  test("pins optional peers exactly too, keeping them optional", () => {
    const manifest: Manifest = {
      name: "@danwo/cli",
      version: "0.0.0",
      private: true,
      dependencies: { "@danwo/runner": "workspace:*" },
      peerDependencies: { "@danwo/mobile": "workspace:*", "@danwo/mcp": "workspace:*" },
      peerDependenciesMeta: {
        "@danwo/mobile": { optional: true },
        "@danwo/mcp": { optional: true },
      },
      devDependencies: { "@danwo/mobile": "workspace:*", "@danwo/mcp": "workspace:*" },
    }
    const staged = stagedManifest(manifest, VERSION)

    expect(staged.peerDependencies).toEqual({ "@danwo/mobile": VERSION, "@danwo/mcp": VERSION })
    expect(staged["peerDependenciesMeta"]).toEqual(manifest["peerDependenciesMeta"])
    expect(
      publishOrder([manifest, workspace("mobile").manifest, workspace("mcp").manifest]),
    ).toEqual(["@danwo/mcp", "@danwo/mobile", "@danwo/cli"])
  })

  test("publishes every package but fidelity and ui", () => {
    const packages = ["cli", "fidelity", "sdk", "ui"].map((folder) => workspace(folder))

    expect(publicPackages(packages).map((pkg) => pkg.folder)).toEqual(["cli", "sdk"])
  })
})

describe("publishOrder", () => {
  test("puts each package after the ones it depends on, ties alphabetically", () => {
    const manifests = [
      workspace("cli", ["sdk", "runner"]),
      workspace("sdk", ["runner", "data"]),
      workspace("runner", ["proxy"]),
      workspace("proxy"),
      workspace("data"),
    ].map((pkg) => pkg.manifest)

    expect(publishOrder(manifests)).toEqual([
      "@danwo/data",
      "@danwo/proxy",
      "@danwo/runner",
      "@danwo/sdk",
      "@danwo/cli",
    ])
  })

  test("ignores dev dependencies and packages outside the release", () => {
    const manifests = [
      workspace("a", ["outside"], { devDependencies: { "@danwo/b": "workspace:*" } }),
      workspace("b", ["a"]),
    ].map((pkg) => pkg.manifest)

    expect(publishOrder(manifests)).toEqual(["@danwo/a", "@danwo/b"])
  })

  test("refuses a cycle", () => {
    const manifests = [workspace("a", ["b"]), workspace("b", ["a"])].map((pkg) => pkg.manifest)

    expect(() => publishOrder(manifests)).toThrow("dependency cycle among @danwo/a, @danwo/b")
  })
})

describe("refusals", () => {
  const packages = [workspace("cli", ["sdk"]), workspace("sdk"), workspace("ui")]

  test("lets a clean tree, a semantic version and public dependencies through", () => {
    expect(refusals({ version: VERSION, gitStatus: "", packages })).toEqual([])
  })

  test("refuses a dirty tree and names its changes", () => {
    expect(refusals({ version: VERSION, gitStatus: " M README.md\n", packages })).toEqual([
      "the git tree has changes:\n M README.md",
    ])
  })

  test("refuses a version that is not semver", () => {
    expect(refusals({ version: "v0.1", gitStatus: "", packages })).toEqual([
      '"v0.1" is not a semantic version',
    ])
  })

  test("refuses a public package that needs a private one at run time, not as a dev dependency", () => {
    const leaking = [
      workspace("cli", [], { peerDependencies: { "@danwo/fidelity": "workspace:*" } }),
      workspace("dashboard", ["ui"]),
      workspace("sdk", [], { devDependencies: { "@danwo/ui": "workspace:*" } }),
      workspace("fidelity"),
      workspace("ui"),
    ]

    expect(refusals({ version: VERSION, gitStatus: "", packages: leaking })).toEqual([
      "@danwo/cli needs @danwo/fidelity at run time, which stays private",
      "@danwo/dashboard needs @danwo/ui at run time, which stays private",
    ])
  })
})

describe("the summary", () => {
  test("reads npm pack's JSON and refuses output without a tarball", () => {
    const json = JSON.stringify([
      {
        name: "@danwo/cli",
        filename: "danwo-cli-0.1.0-beta.0.tgz",
        size: 312_400,
        unpackedSize: 1_204_000,
        files: [],
      },
    ])

    expect(packedTarball(json)).toEqual({
      name: "@danwo/cli",
      filename: "danwo-cli-0.1.0-beta.0.tgz",
      size: 312_400,
      unpackedSize: 1_204_000,
    })
    expect(() => packedTarball("[]")).toThrow("npm pack printed no tarball")
  })

  test("lists each package, its tarball and size, with the total", () => {
    const tarballs = [
      {
        name: "@danwo/cli",
        filename: "danwo-cli-1.0.0.tgz",
        size: 312_400,
        unpackedSize: 1_204_000,
      },
      {
        name: "@danwo/dashboard",
        filename: "danwo-dashboard-1.0.0.tgz",
        size: 5_912_345,
        unpackedSize: 9_000_000,
      },
    ]

    expect(summaryLines(tarballs, "/out")).toEqual([
      "2 tarballs in /out (6.2 MB)",
      "  @danwo/cli        danwo-cli-1.0.0.tgz        312.4 kB  (1.2 MB unpacked)",
      "  @danwo/dashboard  danwo-dashboard-1.0.0.tgz    5.9 MB  (9.0 MB unpacked)",
    ])
    expect(formatSize(999)).toBe("1.0 kB")
  })
})

test("processesUnder finds the processes whose command line names the check project", () => {
  const rows = [
    {
      pid: 101,
      command: "/usr/bin/node --import=file:///tmp/danwo-release-check-ab12/node_modules/x.mjs a",
    },
    { pid: 202, command: "/usr/bin/node /elsewhere/app.mts" },
    {
      pid: 33303,
      command: String.raw`"C:\Program Files\nodejs\node.exe" C:\Temp\danwo-release-check-ab12\x.ts`,
    },
  ]

  expect(processesUnder(rows, "danwo-release-check-ab12").map((found) => found.pid)).toEqual([
    101, 33303,
  ])
})

describe("stepReport", () => {
  test("passes on exit 0 with the expected text, showing the last lines", () => {
    const output = "one\ntwo\n\nthree\nfour\n0.1.0-beta.0\n"
    const report = stepReport("npx @danwo/cli --version", { status: 0, output, ms: 2_450 }, VERSION)

    expect(report).toEqual({
      ok: true,
      lines: [
        "  ok     npx @danwo/cli --version (2.5 s)",
        "         three",
        "         four",
        `         ${VERSION}`,
      ],
    })
  })

  test("fails on a non-zero exit, a missing expected text or no exit at all", () => {
    expect(stepReport("a", { status: 1, output: "boom", ms: 10 }).ok).toBe(false)
    expect(stepReport("a", { status: 0, output: "0.0.0", ms: 10 }, VERSION).ok).toBe(false)
    expect(stepReport("a", { status: null, output: "", ms: 10 }).lines).toEqual([
      "  FAILED a (0.0 s)",
    ])
  })

  test("passes a step that must fail only on the exit status it names", () => {
    const missing = "danwo build-ios needs @danwo/mobile: npm install -D @danwo/mobile"

    expect(stepReport("a", { status: 2, output: missing, ms: 10 }, "needs", 2).ok).toBe(true)
    expect(stepReport("a", { status: 0, output: missing, ms: 10 }, "needs", 2).ok).toBe(false)
    expect(stepReport("a", { status: 1, output: missing, ms: 10 }, "needs", 2).ok).toBe(false)
  })
})
