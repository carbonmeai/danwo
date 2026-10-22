/**
 * The machine's processes, with each one's parent and command line, on every platform: `ps` on
 * macOS and Linux, and CIM's `Win32_Process` through PowerShell on Windows, which has no `ps`.
 * Parsing is kept apart from listing, so each platform's format is tested on any machine.
 */
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"

/** One running process. */
export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly command: string
  /** When it started, in milliseconds since the epoch; 0 where the listing does not say. */
  readonly started: number
}

/** The PowerShell that prints every process as JSON, without loading a profile. */
const CIM_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; command = $_.CommandLine; started = if ($_.CreationDate) { [long]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } else { 0 } } } | ConvertTo-Json -Compress"

/** The program and arguments that list the processes on `platform`. */
export function listingCommand(platform: NodeJS.Platform): readonly [string, readonly string[]] {
  return platform === "win32"
    ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", CIM_SCRIPT]]
    : ["ps", ["-A", "-ww", "-o", "pid=,ppid=,command="]]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** The rows in `ps -A -o pid=,ppid=,command=` output. */
function parsePsTable(table: string): ProcessRow[] {
  return table.split(/\r?\n/).flatMap((line) => {
    const [, pid = "", ppid = "", command = ""] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? []

    return pid === "" ? [] : [{ pid: Number(pid), ppid: Number(ppid), command, started: 0 }]
  })
}

/**
 * The rows in the Windows listing's JSON: an array, or one object when a single process
 * matched. A process whose command line Windows withholds (a system one) gets an empty one.
 */
function parseWindowsListing(json: string): ProcessRow[] {
  const trimmed = json.trim()

  if (trimmed === "") return []

  const parsed: unknown = JSON.parse(trimmed)
  const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed]

  return entries.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.pid !== "number") return []

    return [
      {
        pid: entry.pid,
        ppid: typeof entry.ppid === "number" ? entry.ppid : 0,
        command: typeof entry.command === "string" ? entry.command : "",
        started: typeof entry.started === "number" ? entry.started : 0,
      },
    ]
  })
}

/** The rows in what `listingCommand(platform)` printed. */
export function parseListing(platform: NodeJS.Platform, output: string): ProcessRow[] {
  return platform === "win32" ? parseWindowsListing(output) : parsePsTable(output)
}

const LISTING_OPTIONS = {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true,
} as const

/** Every process on this machine; throws when the listing cannot run. */
export function processRows(platform: NodeJS.Platform = process.platform): ProcessRow[] {
  const [command, args] = listingCommand(platform)

  return parseListing(platform, execFileSync(command, [...args], LISTING_OPTIONS))
}

const execFileAsync = promisify(execFile)

/** Every process on this machine, without blocking; empty when the listing cannot run. */
export async function processRowsAsync(
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessRow[]> {
  const [command, args] = listingCommand(platform)

  try {
    return parseListing(platform, (await execFileAsync(command, [...args], LISTING_OPTIONS)).stdout)
  } catch {
    return []
  }
}

/**
 * Every process started under `root`, however deep, found by parent ids. A parent id can name a
 * process that has ended and whose pid was taken again, so a child must also have started after
 * its parent where the listing says when each one started.
 */
export function descendantsOf(rows: readonly ProcessRow[], root: number): ProcessRow[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const found: ProcessRow[] = []
  const parents = [root]

  /* Walks `parents` as it grows, one generation after another. */
  for (const parentPid of parents) {
    const parentStarted = byPid.get(parentPid)?.started ?? 0

    for (const row of rows) {
      if (row.ppid !== parentPid || parents.includes(row.pid)) continue
      if (row.started > 0 && parentStarted > 0 && row.started < parentStarted) continue

      found.push(row)
      parents.push(row.pid)
    }
  }

  return found
}

/**
 * The program a command line starts, by its file name without `.exe`: `node` for both
 * `/usr/bin/node app.js` and `"C:\Program Files\nodejs\node.exe" app.js`.
 */
export function programName(command: string): string {
  const trimmed = command.trimStart()
  const close = trimmed.indexOf('"', 1)
  const first = trimmed.startsWith('"')
    ? trimmed.slice(1, close < 0 ? undefined : close)
    : (trimmed.split(/\s+/, 1)[0] ?? "")

  return (first.split(/[\\/]/).at(-1) ?? "").replace(/\.exe$/i, "")
}
