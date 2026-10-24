import { execFileSync } from "node:child_process"
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** A span of TCP ports: `from` included, `to` left out. */
export interface PortRange {
  readonly from: number
  readonly to: number
}

/**
 * Where `freePort()` picks from: below the ports the common systems hand out for port 0 and for
 * outgoing connections (Linux from 32768, macOS and Windows from 49152).
 */
const PREFERRED: PortRange = { from: 20_000, to: 32_768 }

/** With fewer ports than this left outside the system's own range, the system picks. */
const SMALLEST_RANGE = 1_000

/** The range Windows and the BSDs hand out by default, and the one assumed when none is read. */
const IANA_EPHEMERAL: PortRange = { from: 49_152, to: 65_536 }

/**
 * The ports the system hands out for port 0 and for outgoing connections, as it is set here:
 * Linux's `ip_local_port_range`, macOS's `portrange` sysctls, or the range Windows uses.
 */
export function ephemeralRange(platform: NodeJS.Platform = process.platform): PortRange {
  try {
    const text =
      platform === "linux"
        ? readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8")
        : platform === "darwin"
          ? execFileSync(
              "sysctl",
              ["-n", "net.inet.ip.portrange.first", "net.inet.ip.portrange.last"],
              { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
            )
          : ""
    const [first, last] = text.trim().split(/\s+/).map(Number)

    return first !== undefined && last !== undefined && first > 0 && last >= first
      ? { from: first, to: last + 1 }
      : IANA_EPHEMERAL
  } catch {
    return IANA_EPHEMERAL
  }
}

/**
 * The wider part of `preferred` that `ephemeral` leaves out, or `undefined` when that is fewer
 * than `SMALLEST_RANGE` ports.
 */
export function rangeOutside(preferred: PortRange, ephemeral: PortRange): PortRange | undefined {
  const below: PortRange = { from: preferred.from, to: Math.min(preferred.to, ephemeral.from) }
  const above: PortRange = { from: Math.max(preferred.from, ephemeral.to), to: preferred.to }
  const wider = below.to - below.from >= above.to - above.from ? below : above

  return wider.to - wider.from >= SMALLEST_RANGE ? wider : undefined
}

/** Removes `path`, which may be gone already. */
function remove(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    /* Already gone. */
  }
}

/** The process id a port's note holds, or `undefined` when the note is gone or unreadable. */
function ownerOf(file: string): number | undefined {
  try {
    const pid = Number(readFileSync(file, "utf8").trim())

    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

/** Whether a process with this id runs: one this user may not signal runs too. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return Reflect.get(Object(error), "code") === "EPERM"
  }
}

/** Whether a server can listen on `port` on 127.0.0.1 now; the probe closes before it answers. */
function listenable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once("error", () => resolve(false))
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true))
    })
  })
}

/** A port the system picks for port 0 on 127.0.0.1. */
function systemPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("the port probe did not listen on a TCP port")),
      )
    })
  })
}

/** Options of {@link portPicker}. */
export interface PortPickerOptions {
  /** The folder each process notes the ports it named in: one file per port, holding its pid. */
  readonly notes: string
  /** Where to pick from; `undefined` lets the system pick, as for port 0. */
  readonly range: PortRange | undefined
}

/**
 * A `freePort()` over `options`. Each port it names is one a probe could listen on, that no other
 * running process with the same notes folder named, and that it never names twice; its notes are
 * removed when the process exits.
 */
export function portPicker(options: PortPickerOptions): () => Promise<number> {
  const named = new Set<number>()
  const noted: string[] = []
  let cleanupPlaced = false

  /** Removes this process's notes as it exits; placed with the first note. */
  const placeCleanup = () => {
    if (cleanupPlaced) return
    cleanupPlaced = true
    process.once("exit", () => {
      for (const file of noted) remove(file)
    })
  }

  /**
   * Notes `port` as this process's; false when a running process noted it first. The note is
   * written whole under another name and linked into place, which fails when one is there, so no
   * process reads a note half written.
   */
  const note = (port: number): boolean => {
    const file = join(options.notes, String(port))
    const draft = join(options.notes, `.${port}.${process.pid}`)

    writeFileSync(draft, String(process.pid))

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          linkSync(draft, file)
          noted.push(file)
          placeCleanup()

          return true
        } catch (error) {
          if (Reflect.get(Object(error), "code") !== "EEXIST") throw error

          const owner = ownerOf(file)

          if (owner !== undefined && running(owner)) return false
          /* Left by a process that ended without removing its notes: the port is free to note. */
          remove(file)
        }
      }

      return false
    } finally {
      remove(draft)
    }
  }

  /** Takes back the note on a port the probe could not listen on. */
  const unnote = (port: number) => {
    const file = join(options.notes, String(port))
    const index = noted.indexOf(file)

    if (index >= 0) noted.splice(index, 1)
    remove(file)
  }

  /** `port`, once it is noted as this process's and a server could listen on it; or `undefined`. */
  const take = async (port: number): Promise<number | undefined> => {
    if (named.has(port) || !note(port)) return undefined
    named.add(port)
    if (await listenable(port)) return port
    named.delete(port)
    unnote(port)

    return undefined
  }

  return async () => {
    mkdirSync(options.notes, { recursive: true })

    const { range } = options

    if (range === undefined) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const port = await take(await systemPort())

        if (port !== undefined) return port
      }

      throw new Error("no free port: every port the system offered was taken")
    }

    const size = range.to - range.from
    const start = Math.floor(Math.random() * size)

    for (let step = 0; step < size; step++) {
      const port = await take(range.from + ((start + step) % size))

      if (port !== undefined) return port
    }

    throw new Error(`no free port between ${range.from} and ${range.to - 1}`)
  }
}

let picker: (() => Promise<number>) | undefined

/**
 * A TCP port nothing listens on now, on 127.0.0.1: for an app a config starts on a port of its
 * own, as in `url: \`http://127.0.0.1:${await freePort()}\``, so runs and workers never collide.
 *
 * Nothing holds the port between this answer and the app listening on it, so it comes from where
 * nothing else takes one meanwhile: outside the range the system hands out for port 0 and for
 * outgoing connections (a proxy, a database container, a dev server's own listeners all take
 * theirs there), and noted in a folder every danwo process on the machine reads, so no other
 * worker or run names it while this process runs. Where the system's range leaves too little room
 * outside it, the system picks, and the notes still keep danwo's processes apart.
 */
export function freePort(): Promise<number> {
  picker ??= portPicker({
    notes: join(tmpdir(), "danwo-ports"),
    range: rangeOutside(PREFERRED, ephemeralRange()),
  })

  return picker()
}
