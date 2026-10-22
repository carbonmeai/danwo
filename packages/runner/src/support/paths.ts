/**
 * Paths as danwo shows and stores them: relative to the project, always with forward slashes.
 * Test ids, flight records, the replay cache and `.danwo/impact.json` hold these, so a record or a
 * cache written on Windows matches one written on macOS or Linux. The path module is injected, so
 * the Windows behaviour is tested on any machine.
 */
import nodePath, { type PlatformPath } from "node:path"
import { fileURLToPath } from "node:url"

/** `path` with the platform's separators turned into forward slashes. */
export function slashed(path: string, platform: PlatformPath = nodePath): string {
  return platform.sep === "/" ? path : path.split(platform.sep).join("/")
}

/** `file` relative to `from`, with forward slashes. */
export function relativeSlashed(
  from: string,
  file: string,
  platform: PlatformPath = nodePath,
): string {
  return slashed(platform.relative(from, file), platform)
}

/**
 * The file a stack frame names, as a path of `platform`: a `file:` URL (every ES module's frame
 * reads `file:///C:/app/x.ts` on Windows) decoded, its query kept when `keepQuery` asks, or a
 * plain path as it is.
 */
export function framePath(
  location: string,
  platform: PlatformPath = nodePath,
  keepQuery = false,
): string {
  if (!location.startsWith("file:")) return location

  const url = new URL(location)
  const query = keepQuery ? url.search : ""

  url.search = ""

  return `${urlPath(url, platform)}${query}`
}

/**
 * A `file:` URL's path on `platform`. A URL with no drive (`file:///srv/x.ts`) names no path
 * Windows can open, so there it stays as the URL's own decoded path rather than failing.
 */
function urlPath(url: URL, platform: PlatformPath): string {
  try {
    return fileURLToPath(url, { windows: platform.sep === "\\" })
  } catch {
    return decodeURIComponent(url.pathname)
  }
}
