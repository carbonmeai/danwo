import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  applyNetworkConfig,
  buildAndroid,
  NETWORK_CONFIG_NAME,
  sourceHash,
  withNetworkConfig,
} from "../src/index.ts"

let project: string

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "danwo-expo-"))
  await writeFile(join(project, "package.json"), '{"name":"app"}')
  await writeFile(join(project, "App.tsx"), "export default function App() {}")
})

afterEach(async () => {
  await rm(project, { recursive: true, force: true })
})

describe("the danwo network config", () => {
  it("points the manifest's application at it, replacing any config already there", () => {
    const reference = `android:networkSecurityConfig="@xml/${NETWORK_CONFIG_NAME}"`

    expect(
      withNetworkConfig('<manifest><application android:label="x"></application></manifest>'),
    ).toBe(`<manifest><application ${reference} android:label="x"></application></manifest>`)
    expect(
      withNetworkConfig(
        '<application android:networkSecurityConfig="@xml/theirs" android:label="x">',
      ),
    ).toBe(`<application ${reference} android:label="x">`)
    expect(() => withNetworkConfig("<manifest/>")).toThrow("no <application> element")
  })

  it("writes the XML resource that trusts user CAs into a prebuilt project", async () => {
    const main = join(project, "android", "app", "src", "main")

    await mkdir(main, { recursive: true })
    await writeFile(
      join(main, "AndroidManifest.xml"),
      "<manifest><application></application></manifest>",
    )
    await applyNetworkConfig(join(project, "android"))

    expect(
      await readFile(join(main, "res", "xml", `${NETWORK_CONFIG_NAME}.xml`), "utf8"),
    ).toContain('<certificates src="user" />')
    expect(await readFile(join(main, "AndroidManifest.xml"), "utf8")).toContain(
      "@xml/danwo_network",
    )
  })
})

describe("the build's key", () => {
  it("changes with the app's sources, not with outputs, dependencies or dotfiles", async () => {
    const first = await sourceHash(project)

    await mkdir(join(project, "node_modules", "x"), { recursive: true })
    await writeFile(join(project, "node_modules", "x", "index.js"), "1")
    await mkdir(join(project, "android"), { recursive: true })
    await writeFile(join(project, "android", "build.gradle"), "1")
    await writeFile(join(project, ".gitignore"), "android/")
    expect(await sourceHash(project)).toBe(first)

    await writeFile(join(project, "App.tsx"), "export default function App() { return null }")
    expect(await sourceHash(project)).not.toBe(first)
  })

  it("reuses a kept build of the same sources without running the tools", async () => {
    const kept = join(project, ".danwo", "builds", `${await sourceHash(project)}.apk`)

    await mkdir(join(project, ".danwo", "builds"), { recursive: true })
    await writeFile(kept, "apk")

    const build = await buildAndroid({ project })

    expect(build).toMatchObject({ apk: kept, cached: true })
  })
})
