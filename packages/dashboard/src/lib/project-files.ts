/**
 * Where the dashboard reads from: the project's `.danwo` folder, and nothing outside it. Every path
 * a page asks for is resolved against that folder and refused when it would leave it.
 */
import { readdir, readFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

/** The project the dashboard shows: the folder `danwo serve` ran in, or the current one. */
export function projectRoot(): string {
  return resolve(process.env.DANWO_PROJECT_ROOT ?? process.cwd())
}

export function danwoDir(root: string): string {
  return join(root, ".danwo")
}

/**
 * `path` (relative to the project root) resolved inside `.danwo/<area>`; throws when it would point
 * anywhere else, so a crafted path cannot read the rest of the disk.
 */
export function insideArea(root: string, area: string, path: string): string {
  const base = join(danwoDir(root), area)
  const full = resolve(root, path)
  const rel = relative(base, full)

  if (
    rel === "" ||
    rel.startsWith("..") ||
    rel.split(sep).includes("..") ||
    resolve(base, rel) !== full
  )
    throw new Error(`${path} is not inside .danwo/${area}`)

  return full
}

/** The names of the folder's entries, or none when it does not exist. */
export async function entries(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).toSorted((a, b) => a.localeCompare(b))
}

/** A JSON file's parsed contents, or undefined when it is missing or not JSON. */
export async function readJson(path: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))

    return parsed
  } catch {
    return undefined
  }
}

/** Whether `value` is an object with `version: 1`, the mark of every file danwo writes. */
export function isVersioned(value: unknown): value is { readonly version: 1 } {
  return typeof value === "object" && value !== null && "version" in value && value.version === 1
}
