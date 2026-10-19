/**
 * Installs danwo's skill into a project's agent skill folders: `.claude/skills/danwo` for Claude
 * Code, and `.agents/skills/danwo`, the shared folder Codex, Cursor and other agents read. A file
 * the user edited is never overwritten: a marker beside it remembers what danwo last wrote, and
 * only a file still matching that marker is updated to the shipped version.
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** The skill as this package ships it. */
export const SKILL_FILE = fileURLToPath(new URL("../skill/danwo/SKILL.md", import.meta.url))

/** Where agents look for a project's skills. */
export const SKILL_DIRS = [".claude/skills/danwo", ".agents/skills/danwo"]

/** The marker beside an installed skill: the hash of the text danwo wrote there. */
const MARKER = ".danwo-skill.json"

export interface SkillChange {
  /** Relative to the project folder. */
  readonly file: string
  /** `kept`: the file was edited since danwo wrote it, so it was left alone. */
  readonly outcome: "created" | "updated" | "unchanged" | "kept"
}

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

async function readText(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, "utf8") : undefined
}

/** The hash danwo recorded when it last wrote the skill into `dir`. */
async function writtenHash(dir: string): Promise<string | undefined> {
  const text = await readText(join(dir, MARKER))

  if (text === undefined) return undefined

  try {
    const parsed: unknown = JSON.parse(text)

    return typeof parsed === "object" && parsed !== null && "sha256" in parsed
      ? String(parsed.sha256)
      : undefined
  } catch {
    return undefined
  }
}

async function writeSkill(dir: string, text: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "SKILL.md"), text)
  await writeFile(join(dir, MARKER), `${JSON.stringify({ sha256: hashOf(text) })}\n`)
}

async function installInto(cwd: string, folder: string, shipped: string): Promise<SkillChange> {
  const dir = join(cwd, folder)
  const file = join(folder, "SKILL.md")
  const current = await readText(join(dir, "SKILL.md"))

  if (current === undefined) {
    await writeSkill(dir, shipped)

    return { file, outcome: "created" }
  }

  if (current === shipped) return { file, outcome: "unchanged" }
  if ((await writtenHash(dir)) !== hashOf(current)) return { file, outcome: "kept" }

  await writeSkill(dir, shipped)

  return { file, outcome: "updated" }
}

/**
 * Installs or updates the skill in each agent folder (every one in `SKILL_DIRS` by default),
 * keeping files the user edited.
 */
export async function installSkill(
  cwd: string,
  folders: readonly string[] = SKILL_DIRS,
): Promise<SkillChange[]> {
  const shipped = await readFile(SKILL_FILE, "utf8")
  const changes: SkillChange[] = []

  for (const folder of new Set(folders)) changes.push(await installInto(cwd, folder, shipped))

  return changes
}
