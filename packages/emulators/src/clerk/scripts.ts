import { existsSync, readdirSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join, posix } from "node:path"

import type { Context, Middleware } from "../http.ts"

/** The packages a Frontend API host serves under `/npm/`, as Clerk's CDN does. */
const SERVED = new Set(["@clerk/clerk-js", "@clerk/ui"])

/** Where downloaded scripts are kept between runs. */
const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "danwo", "clerk")

/** Where scripts are fetched from when no installed copy fits: a public npm CDN. */
const UPSTREAM = "https://cdn.jsdelivr.net/npm"

/** Where that CDN says which exact version a range like `1` stands for. */
const RESOLVER = "https://data.jsdelivr.com/v1/packages/npm"

const TYPES: Readonly<Record<string, string>> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
}

/** A request for `/npm/<package>@<version>/<file>`, split up. */
interface ScriptRequest {
  readonly name: string
  readonly version: string
  readonly file: string
}

/** Reads `/npm/@scope/name@version/dist/file.js`, or nothing for other paths. */
function scriptRequest(path: string): ScriptRequest | undefined {
  const match = /^\/npm\/(@[^/]+\/[^/@]+)@([^/]+)\/(.+)$/.exec(path)

  if (!match) return undefined

  const [, name = "", version = "", file = ""] = match
  /* A URL's path: normalized with forward slashes on every platform, as it goes into the CDN's URL. */
  const clean = posix.normalize(file)

  if (!SERVED.has(name) || clean.startsWith("..") || clean.includes("/..")) return undefined

  return { name, version, file: clean }
}

/** The version a package manifest declares. */
function manifestVersion(manifest: string): string {
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"))

  return parsed !== null &&
    typeof parsed === "object" &&
    "version" in parsed &&
    typeof parsed.version === "string"
    ? parsed.version
    : ""
}

/**
 * The manifests of `name` that the app (from the working directory) and danwo would load, nearest
 * first. They are found by path, as the packages' exports maps do not expose `package.json`.
 */
function manifestsOf(name: string): string[] {
  const from = [join(process.cwd(), "package.json"), import.meta.filename]
  const dirs = from.flatMap((base) => createRequire(base).resolve.paths(name) ?? [])

  return dirs.map((dir) => join(dir, name, "package.json")).filter((path) => existsSync(path))
}

/** The installed copy of a package that the app or danwo resolves, if its major version fits. */
function installedRoot(request: ScriptRequest): string | undefined {
  const major = /^\d+/.exec(request.version)?.[0]

  for (const manifest of manifestsOf(request.name))
    if (major === undefined || manifestVersion(manifest).startsWith(`${major}.`))
      return dirname(manifest)

  return undefined
}

/** An exact version, `1.41.2` or `1.42.0-canary.3`, rather than a range like `1`. */
function isExact(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)
}

/** Whether `version` is one the range `range` (`1`, or `1.41`) stands for. */
function fits(range: string, version: string): boolean {
  return version === range || version.startsWith(`${range}.`)
}

/** A version's numbers, `1.41.2` as `[1, 41, 2]`; a pre-release's words count as 0. */
function numbersOf(version: string): number[] {
  return version.split(/[.-]/).map((part) => Number(part) || 0)
}

/** `a` against `b` by their numbers, the newer first, for sorting. */
function newerFirst(a: string, b: string): number {
  const [left, right] = [numbersOf(a), numbersOf(b)]

  for (let i = 0; i < Math.max(left.length, right.length); i += 1)
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (right[i] ?? 0) - (left[i] ?? 0)

  return 0
}

/** How many times the CDN is asked for a file before the emulator gives up on it. */
const DOWNLOAD_ATTEMPTS = 4
/** How long one fetch from the CDN may take. */
const DOWNLOAD_TIMEOUT_MS = 15_000
/** The wait before the second try; it doubles before each later one (0.5 s, 1 s, 2 s). */
const BACKOFF_MS = 500

/** How the emulator fetches from the CDN; tests replace the parts they need. */
interface CdnOptions {
  readonly fetch?: typeof fetch
  /** The wait before the second try, doubling before each later one. */
  readonly backoffMs?: number
}

/** A file from the CDN, or why it could not be had: `404 Not Found`, or the network error. */
type Download =
  | { readonly ok: true; readonly bytes: Buffer }
  | { readonly ok: false; readonly reason: string }

/**
 * A file's bytes from the CDN, tried a few times with a timeout on each try and a growing wait
 * between them, so one slow or failed fetch doesn't fail every page that loads ClerkJS. A 404 is
 * tried again too: the CDN can briefly answer 404 for a range like `@1` while it resolves it.
 */
export async function downloadScript(url: string, options: CdnOptions = {}): Promise<Download> {
  const get = options.fetch ?? fetch
  let reason = "no answer"

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const answer = await get(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })

      if (answer.ok) return { ok: true, bytes: Buffer.from(await answer.arrayBuffer()) }
      reason = `${answer.status} ${answer.statusText}`.trim()
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }

    if (attempt < DOWNLOAD_ATTEMPTS)
      await new Promise((resolve) =>
        setTimeout(resolve, (options.backoffMs ?? BACKOFF_MS) * 2 ** (attempt - 1)),
      )
  }

  return { ok: false, reason }
}

/**
 * The exact version of each successful resolution, by `name@range`, kept for the whole run; one
 * table per fetch function, so a test's fake CDN has a table of its own.
 */
const resolutions = new WeakMap<typeof fetch, Map<string, Promise<string | undefined>>>()

/** `bytes` read as JSON, or undefined when they are not. */
function jsonOf(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString())
  } catch {
    return undefined
  }
}

/** The exact version the CDN resolution answer names, if it names one. */
function resolvedVersion(answer: unknown): string | undefined {
  return answer !== null &&
    typeof answer === "object" &&
    "version" in answer &&
    typeof answer.version === "string" &&
    isExact(answer.version)
    ? answer.version
    : undefined
}

/**
 * The exact version a range like `1` stands for on the CDN now, so the file is fetched and cached
 * at that version, or undefined when the CDN can't say. A good answer serves the rest of the run;
 * a failed one is asked again by the next request.
 */
function resolveVersion(
  name: string,
  range: string,
  options: CdnOptions = {},
): Promise<string | undefined> {
  if (isExact(range)) return Promise.resolve(range)

  const get = options.fetch ?? fetch
  const resolved = resolutions.get(get) ?? new Map<string, Promise<string | undefined>>()
  const key = `${name}@${range}`
  const known = resolved.get(key)

  resolutions.set(get, resolved)

  if (known !== undefined) return known

  const asking = downloadScript(
    `${RESOLVER}/${name}/resolved?specifier=${encodeURIComponent(range)}`,
    options,
  ).then((download) => {
    const version = download.ok ? resolvedVersion(jsonOf(download.bytes)) : undefined

    if (version === undefined) resolved.delete(key)

    return version
  })

  resolved.set(key, asking)

  return asking
}

/** Where a file of `name@version` is kept between runs. */
function cachePath(cacheDir: string, name: string, version: string, file: string): string {
  return join(cacheDir, `${name}@${version}`, file)
}

/**
 * The newest copy of the file in the cache from a version the request's range stands for, for when
 * the CDN can't be reached: kept under an exact version, or under the range itself.
 */
function cachedFallback(cacheDir: string, request: ScriptRequest): string | undefined {
  const [scope = "", base = ""] = request.name.split("/")
  let entries: string[] = []

  try {
    entries = readdirSync(join(cacheDir, scope))
  } catch {
    return undefined
  }

  const versions = entries
    .filter((entry) => entry.startsWith(`${base}@`))
    .map((entry) => entry.slice(base.length + 1))
    .filter((version) => fits(request.version, version))
    .toSorted(newerFirst)

  return versions
    .map((version) => cachePath(cacheDir, request.name, version, request.file))
    .find((path) => existsSync(path))
}

/** How a script is found: tests point these at a fake CDN and a cache of their own. */
export interface ScriptOptions extends CdnOptions {
  /** Where downloaded scripts are kept; `~/.cache/danwo/clerk` by default. */
  readonly cacheDir?: string
  /** Whether a copy the app or danwo has installed is served first; true by default. */
  readonly installed?: boolean
  /** How a script that can't be had is reported; a process warning by default, once per URL. */
  readonly warn?: (message: string) => void
}

/** A requested file's bytes, or why there are none. */
type Script = Download

/** The URLs a failure was reported for, so a script every page asks for is reported once. */
const reported = new Set<string>()

function warnOnce(url: string, message: string): void {
  if (reported.has(url)) return

  reported.add(url)
  process.emitWarning(message)
}

/** The same download asked for by pages at once, so they share one round of tries. */
const downloading = new Map<string, Promise<Download>>()

function downloadShared(url: string, options: CdnOptions): Promise<Download> {
  const running = downloading.get(url)

  if (running !== undefined) return running

  const download = downloadScript(url, options).finally(() => downloading.delete(url))

  downloading.set(url, download)

  return download
}

/**
 * The bytes of a requested file: an installed copy, the cache, or a download into the cache. A
 * range like `@1` is resolved to an exact version first, and the file cached under it. When the
 * file can't be had, a copy cached from an earlier run of a version the range stands for will do;
 * when there is none, the failure is reported with the URL and the CDN's answer.
 */
export async function loadScript(
  path: string,
  options: ScriptOptions = {},
): Promise<Script | undefined> {
  const request = scriptRequest(path)

  if (request === undefined) return undefined

  const local = options.installed === false ? undefined : installedFile(request)

  return local === undefined
    ? fromCdn(request, options)
    : { ok: true, bytes: await readFile(local) }
}

/** The requested file in the copy the app or danwo has installed, when there is one. */
function installedFile(request: ScriptRequest): string | undefined {
  const root = installedRoot(request)
  const local = root === undefined ? undefined : join(root, request.file)

  return local !== undefined && existsSync(local) ? local : undefined
}

/** The requested file from the cache or the CDN, at the exact version its range stands for. */
async function fromCdn(request: ScriptRequest, options: ScriptOptions): Promise<Script> {
  const cacheDir = options.cacheDir ?? CACHE_DIR
  const version = (await resolveVersion(request.name, request.version, options)) ?? request.version
  const cached = cachePath(cacheDir, request.name, version, request.file)

  if (existsSync(cached)) return { ok: true, bytes: await readFile(cached) }

  const url = `${UPSTREAM}/${request.name}@${version}/${request.file}`
  const download = await downloadShared(url, options)

  if (download.ok) {
    await mkdir(dirname(cached), { recursive: true })
    await writeFile(cached, download.bytes)

    return download
  }

  const fallback = cachedFallback(cacheDir, request)

  if (fallback !== undefined) return { ok: true, bytes: await readFile(fallback) }

  const message = `danwo: Clerk's emulator could not fetch ${url} (${download.reason}), so pages that load it will not get Clerk's UI`

  if (options.warn) options.warn(message)
  else warnOnce(url, message)

  return { ok: false, reason: message }
}

/** The file as a response, with a type by extension and CORS open as a CDN serves it. */
function respond(c: Context, path: string, script: Script): Response {
  if (!script.ok) return c.text(script.reason, 404)

  const type = TYPES[/\.[a-z]+$/.exec(path)?.[0] ?? ""] ?? "application/octet-stream"

  return new Response(new Uint8Array(script.bytes), {
    headers: {
      "content-type": type,
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  })
}

/**
 * Serves ClerkJS and its UI bundle from the Frontend API host, the way Clerk's CDN does
 * (`/npm/@clerk/clerk-js@6/dist/clerk.browser.js`), so an app's script tag and `<ClerkProvider>`
 * load unchanged. It uses the copy the app has installed when its major version fits, else one
 * downloaded once from a public npm CDN and cached under `~/.cache/danwo/clerk`.
 */
export function clerkScripts(): Middleware {
  return async (c, next) => {
    const script = c.req.method === "GET" ? await loadScript(c.req.path) : undefined

    return script === undefined ? next() : respond(c, c.req.path, script)
  }
}
