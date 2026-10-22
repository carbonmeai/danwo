/**
 * A device session on a real iOS Simulator, through the MCP server: open the Settings app, read its
 * screen, tap into a page and back, check a locator, take a screenshot, and see a browser's own
 * tool refused. Runs only when asked (`DANWO_IOS=1`) on a Mac with Xcode; otherwise it skips at
 * once. The simulator is this file's own, named for its process, created for the run and deleted
 * when the session closes.
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "../../cli/test/work-copy.ts"
import { connect, resultOf, textOf } from "./client.ts"

/** A boot, the driver's first build and a few taps take minutes. */
const LONG = { timeout: 900_000 }
const SIMULATOR = `danwo mcp iPhone ${process.pid}`

/** Whether this Mac has Xcode with simctl (the command-line tools alone have no Simulator). */
function hasXcode(): boolean {
  if (process.platform !== "darwin") return false

  try {
    return execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).includes(".app/")
  } catch {
    return false
  }
}

const ready = process.env.DANWO_IOS === "1" && hasXcode()

/** The simulators named `name`, by udid. */
function simulatorsNamed(name: string): string[] {
  const listed: unknown = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "--json"], { encoding: "utf8" }),
  )
  const devices =
    typeof listed === "object" && listed !== null ? Reflect.get(listed, "devices") : undefined

  return Object.values(typeof devices === "object" && devices !== null ? devices : {})
    .flat()
    .flatMap((device: unknown) =>
      typeof device === "object" &&
      device !== null &&
      Reflect.get(device, "name") === name &&
      typeof Reflect.get(device, "udid") === "string"
        ? [String(Reflect.get(device, "udid"))]
        : [],
    )
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = resultOf(
    await client.callTool({ name, arguments: args }, CallToolResultSchema, LONG),
  )

  if (result.isError === true) throw new Error(`${name} failed: ${textOf(result)}`)

  return result
}

async function refused(client: Client, name: string, args: Record<string, unknown>) {
  const result = resultOf(
    await client.callTool({ name, arguments: args }, CallToolResultSchema, LONG),
  )

  expect(result.isError).toBe(true)

  return textOf(result)
}

afterAll(removeWorkCopies)

describe.skipIf(!ready)("a device session on an iOS Simulator", () => {
  let client: Client
  let session = ""
  let opened = ""

  beforeAll(async () => {
    process.env.DANWO_MCP_SIMULATOR = SIMULATOR
    client = await connect(
      workCopy(fileURLToPath(new URL("./fixtures/simulator", import.meta.url))),
    )
    opened = textOf(await call(client, "open_session", { device: true }))
    session = /session (s\d+) is open/.exec(opened)?.[1] ?? ""
  }, LONG.timeout)

  afterAll(async () => {
    await client?.callTool({ name: "close_session", arguments: { session } }).catch(() => undefined)
    await client?.close()
    for (const udid of simulatorsNamed(SIMULATOR))
      execFileSync("xcrun", ["simctl", "delete", udid], { stdio: "ignore" })
  }, 120_000)

  it("opens on the app's screen, with refs and what is in front", () => {
    expect(opened).toContain("device: iOS Simulator")
    expect(opened).toContain("in front: the app com.apple.Preferences")
    expect(opened).toMatch(/"General".* \[ref=e\d+\]/)
  })

  it("checks a locator against the screen", async () => {
    expect(
      textOf(await call(client, "check_locator", { session, locator: 'getByText("General")' })),
    ).toContain('use in a test: screen.getByText("General")')
  })

  it("taps into a page by a locator, and goes back", LONG, async () => {
    const tapped = textOf(await call(client, "click", { session, target: 'getByText("General")' }))

    expect(tapped).toContain('tapped screen.getByText("General")')
    expect(tapped).toMatch(/"About"/)

    const back = textOf(await call(client, "back", { session }))

    expect(back).toContain("went back")
    expect(textOf(await call(client, "snapshot", { session }))).toMatch(/"General".* \[ref=e\d+\]/)
  })

  it("takes a screenshot of the screen", LONG, async () => {
    const shot = await call(client, "screenshot", { session })
    const image = shot.content.find((part) => part.type === "image")

    expect(image?.type === "image" && image.data.length > 1_000).toBe(true)
  })

  it("refuses a browser's own tool", async () => {
    expect(await refused(client, "tabs", { session })).toContain(
      "tabs works on a browser page only, and this session drives an iOS Simulator",
    )
  })

  it("closes, and deletes the simulator it created", LONG, async () => {
    await call(client, "close_session", { session })
    expect(simulatorsNamed(SIMULATOR)).toEqual([])
  })
})
