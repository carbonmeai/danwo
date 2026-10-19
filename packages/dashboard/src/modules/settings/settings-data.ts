/**
 * What the settings page reads: where the project and its `.danwo` folder are, which config file it
 * has, and how much of its history is kept. The dashboard changes none of it; the config file does.
 */
import { access } from "node:fs/promises"
import { join } from "node:path"

import { danwoDir, entries } from "../../lib/project-files.ts"

const CONFIG_FILES = ["danwo.config.ts", "danwo.config.mts", "danwo.config.js", "danwo.config.mjs"]

export interface ProjectSettings {
  readonly root: string
  readonly config: string | null
  readonly runsKept: number
  readonly historyKept: number
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

export async function settingsOf(root: string): Promise<ProjectSettings> {
  const found = await Promise.all(CONFIG_FILES.map((name) => exists(join(root, name))))
  const [runs, history] = await Promise.all([
    entries(join(danwoDir(root), "runs")),
    entries(join(danwoDir(root), "history")),
  ])

  return {
    root,
    config: CONFIG_FILES[found.indexOf(true)] ?? null,
    runsKept: runs.length,
    historyKept: history.filter((name) => name.endsWith(".json")).length,
  }
}
