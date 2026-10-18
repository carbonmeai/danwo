/**
 * adb, bound to one device. Every command goes through `exec`, which tests replace with a fake that
 * records the commands, so the binder's sequence is checked without a device.
 */
import { execFile } from "node:child_process"

/** Runs a program and gives back what it printed; rejects when it exits non-zero. */
export type Exec = (
  file: string,
  args: readonly string[],
  options?: { readonly timeoutMs?: number },
) => Promise<string>

/** Why a program failed: what it printed, else how it ended (an exit code, a signal, a timeout). */
function failureOf(
  error: Error & { code?: unknown; signal?: unknown; killed?: boolean },
  stdout: string,
  stderr: string,
): string {
  const printed = [stderr.trim(), stdout.trim()].filter((text) => text !== "").join("\n")

  if (printed !== "") return printed.slice(-2000)
  if (error.killed === true) return `timed out (${String(error.signal)})`

  return error.code === undefined ? error.message : `exited ${String(error.code)}`
}

/** The real `exec`: the program's stdout, or an error carrying what it printed. */
export const execProgram: Exec = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: options.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error)
          reject(new Error(`${file} ${args.join(" ")}: ${failureOf(error, stdout, stderr)}`))
        else resolve(stdout)
      },
    )
  })

/** adb for one device serial. */
export class Adb {
  readonly path: string
  readonly serial: string
  private readonly exec: Exec

  constructor(path: string, serial: string, exec: Exec = execProgram) {
    this.path = path
    this.serial = serial
    this.exec = exec
  }

  /** `adb -s <serial> <args>`. */
  run(args: readonly string[], timeoutMs?: number): Promise<string> {
    return this.exec(this.path, ["-s", this.serial, ...args], {
      ...(timeoutMs !== undefined && { timeoutMs }),
    })
  }

  /** `adb shell <command>`, trimmed. */
  async shell(command: string, timeoutMs?: number): Promise<string> {
    return (await this.run(["shell", command], timeoutMs)).trim()
  }

  /** Whether adbd runs as root, so files outside the shell user's reach can be written. */
  async isRoot(): Promise<boolean> {
    return (await this.shell("id -u")) === "0"
  }

  /** Waits until the device answers, after a boot or an adbd restart. */
  async waitForDevice(timeoutMs = 120_000): Promise<void> {
    await this.run(["wait-for-device"], timeoutMs)
  }
}
