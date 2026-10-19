/**
 * A record's videos over HTTP, with byte ranges so the player can seek without loading the whole
 * file. Only video files inside `.danwo/runs` are served; nothing here writes.
 */
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname, join } from "node:path"
import { Readable } from "node:stream"

import { insideArea } from "../../lib/project-files.ts"

const VIDEO_TYPES: Readonly<Record<string, string>> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
}

/** The bytes a `Range: bytes=a-b` header asks for out of `size`; undefined for none or a bad one. */
export function byteRange(
  header: string | null,
  size: number,
): { readonly start: number; readonly end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "")

  if (match === null || size === 0) return undefined

  const [, from = "", to = ""] = match

  if (from === "" && to === "") return undefined
  if (from === "") return { start: Math.max(size - Number(to), 0), end: size - 1 }

  const start = Number(from)
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1)

  return start <= end ? { start, end } : undefined
}

function stream(path: string, range?: { readonly start: number; readonly end: number }) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node's web stream is the fetch API's ReadableStream
  return Readable.toWeb(createReadStream(path, range)) as ReadableStream<Uint8Array>
}

/**
 * Answers a request for `path` (relative to `.danwo/runs`): the whole file, or the range the
 * request asks for. A path outside the runs, or a file that is not a video, is not found.
 */
export async function serveMedia(root: string, path: string, request: Request): Promise<Response> {
  const type = VIDEO_TYPES[extname(path).toLowerCase()]
  let full: string

  try {
    if (type === undefined) throw new Error("not a video")
    full = insideArea(root, "runs", join(".danwo", "runs", path))
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const info = await stat(full).catch(() => undefined)

  if (info === undefined || !info.isFile()) return new Response("Not found", { status: 404 })

  const headers = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" }
  const range = byteRange(request.headers.get("range"), info.size)

  if (range === undefined)
    return new Response(stream(full), {
      headers: { ...headers, "content-length": String(info.size) },
    })

  return new Response(stream(full, range), {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
    },
  })
}
