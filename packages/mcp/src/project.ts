/**
 * The project the server works on: the folder it was started in and the config file it found
 * there, as `danwo test` would. Every path a tool reads or writes is checked to stay inside the
 * project root.
 */
import { dirname, isAbsolute, relative, resolve } from "node:path"

import { nearestConfig } from "@danwo/runner/runner"

import type { JobPlace } from "./jobs/protocol.ts"

export class Project {
  readonly place: JobPlace
  /** The config file's folder, or the cwd when the project has no config. */
  readonly root: string

  constructor(cwd: string, config?: string) {
    const path = config === undefined ? nearestConfig(cwd) : resolve(cwd, config)

    this.place = { cwd, config }
    this.root = path === undefined ? cwd : dirname(path)
  }

  /** `path` resolved against the root; throws when it would leave the root. */
  inside(path: string): string {
    const full = resolve(this.root, path)
    const within = relative(this.root, full)

    if (within.startsWith("..") || isAbsolute(within)) {
      throw new Error(`${path} is outside the project (${this.root})`)
    }

    return full
  }

  /** `path` relative to the root, with forward slashes. */
  relative(path: string): string {
    return relative(this.root, path).split("\\").join("/")
  }
}
