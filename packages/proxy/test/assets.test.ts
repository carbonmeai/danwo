import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

import {
  blockedLoads,
  blockedLoadsLine,
  isPassableAsset,
  loadKind,
  mergeBlockedLoads,
  type Proxy,
  startProxy,
} from "../src/index.ts"

const run = promisify(execFile)
const CLIENT = fileURLToPath(new URL("./fixtures/headers-client.ts", import.meta.url))

/** Sends one request through `proxy` with these headers; resolves to "<status> <body start>". */
async function send(
  proxy: Proxy,
  url: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    [CLIENT, url, method, ...Object.entries(headers).map(([name, value]) => `${name}=${value}`)],
    {
      env: proxy.env(),
      timeout: 20_000,
    },
  )

  return stdout.trim()
}

describe("what a request loads", () => {
  it("reads each Sec-Fetch-Dest a browser sends", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["image", "image"],
      ["font", "font"],
      ["style", "style"],
      ["video", "video"],
      ["audio", "audio"],
      ["track", "track"],
      ["script", "script"],
      ["document", "document"],
      ["iframe", "frame"],
      ["worker", "worker"],
      ["serviceworker", "worker"],
      ["empty", "request"],
      ["manifest", "request"],
    ]

    for (const [dest, kind] of cases)
      expect(loadKind("/x", { "sec-fetch-dest": dest }), dest).toBe(kind)
  })

  it("passes only GETs of what a page shows, never scripts, pages, frames, workers or fetch()", () => {
    for (const dest of ["image", "font", "style", "video", "audio", "track"])
      expect(isPassableAsset("GET", "/a", { "sec-fetch-dest": dest }), dest).toBe(true)
    for (const dest of ["script", "document", "iframe", "worker", "empty"])
      expect(isPassableAsset("GET", "/a", { "sec-fetch-dest": dest }), dest).toBe(false)
    expect(isPassableAsset("POST", "/logo.png", { "sec-fetch-dest": "image" })).toBe(false)
  })

  it("falls back to the file and Accept when a client sends no Sec-Fetch-Dest", () => {
    expect(loadKind("/logo.png?w=40", { accept: "image/avif,image/webp,*/*" })).toBe("image")
    expect(loadKind("/inter.woff2", { accept: "font/woff2" })).toBe("font")
    /* A server's own call, or a file asked for as data, says nothing of itself. */
    expect(loadKind("/logo.png", { accept: "application/json" })).toBeUndefined()
    expect(loadKind("/v1/charges", {})).toBeUndefined()
    expect(isPassableAsset("GET", "/v1/charges", {})).toBe(false)
  })
})

describe("what a page lost", () => {
  const exchanges = [
    { disposition: "blocked", host: "cdn.example.com", client: "browser", load: "image" },
    { disposition: "blocked", host: "cdn.example.com", client: "browser", load: "image" },
    { disposition: "blocked", host: "cdn.example.com", client: "browser", load: "request" },
    { disposition: "blocked", host: "fonts.example.com", client: "browser", load: "font" },
    /* A server's own blocked call, and loads that went through, are not the page's loss. */
    { disposition: "blocked", host: "api.example.com", client: "server" },
    { disposition: "passthrough", host: "img.example.com", client: "browser", load: "image" },
  ] as const

  it("counts the blocked loads by host and kind, most first", () => {
    expect(blockedLoads(exchanges)).toEqual([
      { host: "cdn.example.com", kind: "image", count: 2 },
      { host: "cdn.example.com", kind: "request", count: 1 },
      { host: "fonts.example.com", kind: "font", count: 1 },
    ])
  })

  it("says it in one line, and adds several attempts up", () => {
    const merged = mergeBlockedLoads([blockedLoads(exchanges), blockedLoads(exchanges)])

    expect(blockedLoadsLine(merged)).toBe(
      'Blocked hosts the pages tried to load: cdn.example.com (4 images, 2 requests), fonts.example.com (2 fonts). Add the ones the app needs to `allow`, or set `assets: "passthrough"` for images and fonts.',
    )
    expect(blockedLoadsLine([])).toBeUndefined()
  })
})

describe("page assets under block", () => {
  it("lets an image through to an unrouted host and records it as an asset, but not its fetch()", async () => {
    const proxy = await startProxy({ routes: [], unmatched: "block" })

    try {
      /* The host does not exist, so the passthrough fails, but not with danwo's refusal. */
      expect(
        await send(proxy, "https://assets.danwo.test/logo.png", { "sec-fetch-dest": "image" }),
      ).not.toContain("passthrough is blocked")
      expect(
        await send(proxy, "https://assets.danwo.test/data.json", { "sec-fetch-dest": "empty" }),
      ).toContain("passthrough is blocked")
      expect(
        await send(
          proxy,
          "https://assets.danwo.test/logo.png",
          { "sec-fetch-dest": "image" },
          "POST",
        ),
      ).toContain("passthrough is blocked")
      expect(
        proxy.exchanges().map((e) => `${e.disposition} ${e.load ?? "-"} ${e.asset === true}`),
      ).toEqual(["passthrough image true", "blocked request false", "blocked image true"])
    } finally {
      await proxy.stop()
    }
  })

  it("refuses page assets with assets: block, and telemetry hosts either way", async () => {
    const strict = await startProxy({ routes: [], unmatched: "block", assets: "block" })
    const loose = await startProxy({ routes: [], unmatched: "block" })
    const image = { "sec-fetch-dest": "image" }

    try {
      expect(await send(strict, "https://assets.danwo.test/logo.png", image)).toContain(
        "passthrough is blocked",
      )
      expect(await send(loose, "https://us.i.posthog.com/pixel.gif", image)).toContain(
        "host is blocked",
      )
      expect(strict.exchanges()[0]?.disposition).toBe("blocked")
      expect(loose.exchanges()[0]?.disposition).toBe("blocked")
    } finally {
      await strict.stop()
      await loose.stop()
    }
  })
})
