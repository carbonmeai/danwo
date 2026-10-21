/**
 * The simulator's own system proxy. A simulator keeps its network settings in its own
 * configuration store, which it fills from the Mac's; every process in it (the app, Safari, a
 * Safari view, a sign-in session) asks that store for its proxy. A small program run inside the
 * simulator reads and writes the store's global proxy entry, so only that simulator's traffic goes
 * through danwo's proxy: the Mac and other simulators keep theirs.
 *
 * The program is built from the Swift source below with Xcode's compiler for the simulator, once
 * per source version and CPU, and kept in danwo's cache folder.
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import type { SimulatorTool } from "./simctl.ts"

/**
 * Reads (`get`) or replaces (`set <json>`) the store's `State:/Network/Global/Proxies` entry and
 * prints the entry as JSON. The store's functions have no header in the iOS SDK, so they are
 * looked up at run time.
 */
const PROXY_HELPER_SOURCE = `import Foundation

typealias Create = @convention(c) (CFAllocator?, CFString, UnsafeRawPointer?, UnsafeRawPointer?) -> OpaquePointer?
typealias Copy = @convention(c) (OpaquePointer?, CFString) -> Unmanaged<CFPropertyList>?
typealias Set = @convention(c) (OpaquePointer?, CFString, CFPropertyList) -> DarwinBoolean

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\\n").data(using: .utf8)!)
  exit(1)
}

guard let framework = dlopen("/System/Library/Frameworks/SystemConfiguration.framework/SystemConfiguration", RTLD_NOW),
  let create = dlsym(framework, "SCDynamicStoreCreate"),
  let copy = dlsym(framework, "SCDynamicStoreCopyValue"),
  let set = dlsym(framework, "SCDynamicStoreSetValue")
else { fail("the simulator's SystemConfiguration has no dynamic store") }

let store = unsafeBitCast(create, to: Create.self)(nil, "danwo" as CFString, nil, nil)
let key = "State:/Network/Global/Proxies" as CFString
let args = CommandLine.arguments

if args.count == 3 && args[1] == "set" {
  guard let value = try? JSONSerialization.jsonObject(with: args[2].data(using: .utf8)!) as? [String: Any]
  else { fail("set takes a JSON object") }
  if !unsafeBitCast(set, to: Set.self)(store, key, value as CFDictionary).boolValue {
    fail("the dynamic store refused the proxy setting")
  }
} else if !(args.count == 2 && args[1] == "get") {
  fail("usage: danwo-sim-proxy get | set <json>")
}

let current = unsafeBitCast(copy, to: Copy.self)(store, key)?.takeRetainedValue() ?? [String: Any]() as CFDictionary
let json = try! JSONSerialization.data(withJSONObject: current, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)
`

/** A proxy entry, as the store holds it. */
export type ProxySettings = Readonly<Record<string, unknown>>

/** The oldest iOS the program runs on. */
const MINIMUM_IOS = "15.0"

/** Where built helpers are kept: `~/Library/Caches/danwo/ios`, or `DANWO_CACHE_HOME/ios`. */
function cacheDir(): string {
  const base = process.env.DANWO_CACHE_HOME ?? join(homedir(), "Library", "Caches", "danwo")

  return join(base, "ios")
}

/** The simulator target triple for this Mac's CPU. */
export function simulatorTarget(arch: string = process.arch): string {
  return `${arch === "x64" ? "x86_64" : "arm64"}-apple-ios${MINIMUM_IOS}-simulator`
}

/** The entry that sends HTTP and HTTPS through `host:port`, keeping the rest of `current`. */
export function proxiedSettings(current: ProxySettings, host: string, port: number): ProxySettings {
  const { __SCOPED__: _scoped, ...global } = current

  return {
    ...global,
    HTTPEnable: 1,
    HTTPProxy: host,
    HTTPPort: port,
    HTTPSEnable: 1,
    HTTPSProxy: host,
    HTTPSPort: port,
  }
}

/** Whether `settings` send HTTPS through `host:port`. */
export function proxiesThrough(settings: ProxySettings, host: string, port: number): boolean {
  return (
    settings.HTTPSEnable === 1 &&
    settings.HTTPSProxy === host &&
    Number(settings.HTTPSPort) === port
  )
}

/** The helper program, built for this Mac's simulators when it is not in the cache yet. */
export async function proxyHelper(tool: SimulatorTool): Promise<string> {
  const target = simulatorTarget()
  const hash = createHash("sha256").update(PROXY_HELPER_SOURCE).update(target).digest("hex")
  const dir = join(cacheDir(), hash.slice(0, 16))
  const program = join(dir, "danwo-sim-proxy")

  if (existsSync(program)) return program

  await mkdir(dir, { recursive: true })

  const source = join(dir, "main.swift")
  const building = `${program}.${process.pid}`

  await writeFile(source, PROXY_HELPER_SOURCE)
  await tool.simctl.xcrun(
    ["--sdk", "iphonesimulator", "swiftc", "-O", "-target", target, source, "-o", building],
    300_000,
  )
  /* Several workers may build at once; each writes its own file and the last rename wins. */
  await rename(building, program)

  return program
}

/** The simulator's proxy entry, read and written through the helper. */
export class SimulatorProxy {
  private readonly tool: SimulatorTool
  private readonly program: string

  constructor(tool: SimulatorTool, program: string) {
    this.tool = tool
    this.program = program
  }

  async read(): Promise<ProxySettings> {
    return parseSettings(await this.tool.spawn(this.program, ["get"]))
  }

  /** Writes `settings` and returns the entry as the store holds it afterwards. */
  async write(settings: ProxySettings): Promise<ProxySettings> {
    return parseSettings(await this.tool.spawn(this.program, ["set", JSON.stringify(settings)]))
  }
}

function parseSettings(output: string): ProxySettings {
  const line = output.trim().split("\n").at(-1) ?? "{}"
  const parsed: unknown = JSON.parse(line)

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`the simulator's proxy helper printed ${JSON.stringify(line)}`)

  return { ...parsed }
}
