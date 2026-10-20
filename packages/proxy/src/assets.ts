/**
 * What a request loads, read from the headers a browser sends with it, so `unmatched: "block"`
 * can still let a page's images and fonts through, and a run can say which hosts a page lost.
 */

/** What a request is for: a page asset, a script, the page itself, a frame, a worker, or a call. */
export type LoadKind =
  | "image"
  | "font"
  | "style"
  | "video"
  | "audio"
  | "track"
  | "script"
  | "document"
  | "frame"
  | "worker"
  | "request"

/** Kinds a page shows rather than runs: blocking them loses a picture or a font, nothing more. */
const ASSET_KINDS: ReadonlySet<LoadKind> = new Set([
  "image",
  "font",
  "style",
  "video",
  "audio",
  "track",
])

/** `Sec-Fetch-Dest` values, by the kind they load. Absent values (e.g. `manifest`) are calls. */
const DESTINATIONS: Readonly<Record<string, LoadKind>> = {
  image: "image",
  font: "font",
  style: "style",
  video: "video",
  audio: "audio",
  track: "track",
  script: "script",
  audioworklet: "script",
  paintworklet: "script",
  xslt: "script",
  document: "document",
  iframe: "frame",
  frame: "frame",
  object: "frame",
  embed: "frame",
  worker: "worker",
  sharedworker: "worker",
  serviceworker: "worker",
}

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i

type Headers = Readonly<Record<string, string | readonly string[] | undefined>>

/** A header's first value. */
function header(headers: Headers, name: string): string | undefined {
  const value = headers[name]

  return typeof value === "string" ? value : value?.[0]
}

/** An image or font by its file extension and an `Accept` that asks for one, for clients with no `Sec-Fetch-Dest`. */
function kindByFile(path: string, accept: string | undefined): LoadKind | undefined {
  const pathname = path.split("?", 1)[0] ?? ""
  const wants = accept?.trim().toLowerCase() ?? ""

  if (IMAGE_FILE.test(pathname) && wants.startsWith("image/")) return "image"
  if (FONT_FILE.test(pathname) && wants.startsWith("font/")) return "font"

  return undefined
}

/**
 * What a request loads, from its `Sec-Fetch-Dest` header, or, when a client sends none, an image
 * or font told by its extension and `Accept`. Undefined for a request that says nothing of
 * itself, as a server's own calls do.
 */
export function loadKind(path: string, headers: Headers): LoadKind | undefined {
  const dest = header(headers, "sec-fetch-dest")?.trim().toLowerCase()

  if (dest !== undefined && dest !== "") return DESTINATIONS[dest] ?? "request"

  return kindByFile(path, header(headers, "accept"))
}

/** True for a kind a page only shows: an image, font, stylesheet or media track. */
export function isAssetKind(kind: LoadKind | undefined): boolean {
  return kind !== undefined && ASSET_KINDS.has(kind)
}

/**
 * True for a `GET` that loads something the page only shows (an image, font, stylesheet, media):
 * the requests `assets: "passthrough"` lets reach an unrouted host while `unmatched` is `block`.
 * Scripts, documents, frames, workers and `fetch()` calls never pass this way.
 */
export function isPassableAsset(method: string, path: string, headers: Headers): boolean {
  return method === "GET" && isAssetKind(loadKind(path, headers))
}

/** One host a run refused, with what the page asked it for and how often. */
export interface BlockedLoad {
  readonly host: string
  readonly kind: LoadKind
  readonly count: number
}

/** The fields of an exchange a blocked-load count reads. */
interface Loaded {
  readonly disposition: "routed" | "passthrough" | "blocked"
  readonly host: string
  readonly client?: "browser" | "server"
  readonly load?: LoadKind
}

/**
 * The blocked requests the pages made, by host and kind, most first: what a page lost to
 * `unmatched: "block"` or to a blocked host. A server's own blocked calls are left out.
 */
export function blockedLoads(exchanges: readonly Loaded[]): BlockedLoad[] {
  const refused = exchanges.filter(
    (exchange) =>
      exchange.disposition === "blocked" &&
      (exchange.client === "browser" || exchange.load !== undefined),
  )

  return mergeBlockedLoads([
    refused.map((exchange) => ({
      host: exchange.host,
      kind: exchange.load ?? "request",
      count: 1,
    })),
  ])
}

/** Plural words for a kind, as the warning says them: "19 images", "1 request". */
const WORDS: Readonly<Record<LoadKind, readonly [string, string]>> = {
  image: ["image", "images"],
  font: ["font", "fonts"],
  style: ["stylesheet", "stylesheets"],
  video: ["video", "videos"],
  audio: ["audio file", "audio files"],
  track: ["text track", "text tracks"],
  script: ["script", "scripts"],
  document: ["page", "pages"],
  frame: ["frame", "frames"],
  worker: ["worker", "workers"],
  request: ["request", "requests"],
}

/** "19 images", "1 request". */
function counted(load: BlockedLoad): string {
  const [one, many] = WORDS[load.kind]

  return `${load.count} ${load.count === 1 ? one : many}`
}

/**
 * The one-line warning for `loads`, or undefined when there were none: each host with what the
 * page asked it for, then how to let it through.
 */
export function blockedLoadsLine(loads: readonly BlockedLoad[]): string | undefined {
  if (loads.length === 0) return undefined

  const byHost = new Map<string, BlockedLoad[]>()

  for (const load of loads) byHost.set(load.host, [...(byHost.get(load.host) ?? []), load])

  const hosts = [...byHost].map(([host, kinds]) => `${host} (${kinds.map(counted).join(", ")})`)

  return `Blocked hosts the pages tried to load: ${hosts.join(", ")}. Add the ones the app needs to \`allow\`, or set \`assets: "passthrough"\` for images and fonts.`
}

/** Adds up the blocked loads of several attempts, host and kind together. */
export function mergeBlockedLoads(lists: readonly (readonly BlockedLoad[])[]): BlockedLoad[] {
  const counts = new Map<string, BlockedLoad>()

  for (const load of lists.flat()) {
    const key = `${load.host} ${load.kind}`
    const seen = counts.get(key)

    counts.set(key, { ...load, count: (seen?.count ?? 0) + load.count })
  }

  return [...counts.values()].toSorted(
    (a, b) => b.count - a.count || a.host.localeCompare(b.host) || a.kind.localeCompare(b.kind),
  )
}
