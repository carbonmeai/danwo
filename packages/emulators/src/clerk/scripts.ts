import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join, normalize, sep } from "node:path"

import type { Context, Middleware } from "../http.ts"

/** The packages a Frontend API host serves under `/npm/`, as Clerk's CDN does. */
const SERVED = new Set(["@clerk/clerk-js", "@clerk/ui"])

/** Where downloaded scripts are kept between runs. */
const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "danwo", "clerk")

/** Where scripts are fetched from when no installed copy fits: a public npm CDN. */
const UPSTREAM = "https://cdn.jsdelivr.net/npm"

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
  const clean = normalize(file)

  if (!SERVED.has(name) || clean.startsWith("..") || clean.includes(`${sep}..`)) return undefined

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

/** The bytes of a requested file: an installed copy, the cache, or a download into the cache. */
async function scriptBytes(request: ScriptRequest): Promise<Buffer | undefined> {
  const root = installedRoot(request)

  if (root !== undefined) {
    const local = join(root, request.file)

    if (existsSync(local)) return readFile(local)
  }

  const cached = join(CACHE_DIR, `${request.name}@${request.version}`, request.file)

  if (existsSync(cached)) return readFile(cached)

  const answer = await fetch(`${UPSTREAM}/${request.name}@${request.version}/${request.file}`)

  if (!answer.ok) return undefined

  const bytes = Buffer.from(await answer.arrayBuffer())

  await mkdir(dirname(cached), { recursive: true })
  await writeFile(cached, bytes)

  return bytes
}

/** The file as a response, with a type by extension and CORS open as a CDN serves it. */
async function serve(c: Context, request: ScriptRequest): Promise<Response> {
  const bytes = await scriptBytes(request)

  if (bytes === undefined) return c.text("Not found", 404)

  const type = TYPES[/\.[a-z]+$/.exec(request.file)?.[0] ?? ""] ?? "application/octet-stream"

  return new Response(new Uint8Array(bytes), {
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
  return (c, next) => {
    const request = c.req.method === "GET" ? scriptRequest(c.req.path) : undefined

    return request === undefined ? next() : serve(c, request)
  }
}
