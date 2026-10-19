/**
 * What the docs read from danwo itself: the capability spec and the task guides, asked of the
 * `danwo` command so the website shows exactly what the installed danwo prints.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { z } from "zod"

const require = createRequire(import.meta.url)
const CLI_PACKAGE = dirname(require.resolve("@danwo/cli/package.json"))
const CLI = join(CLI_PACKAGE, "bin", "danwo.mjs")

/** The repository root, where the README lives. */
export const REPO_ROOT = join(CLI_PACKAGE, "..", "..")

const SpecMemberSchema = z.object({
  name: z.string(),
  signature: z.string().default(""),
  doc: z.string().default(""),
})

const SpecEntrySchema = SpecMemberSchema.extend({
  kind: z.string(),
  members: z.array(SpecMemberSchema).default([]),
})

const SpecSectionSchema = z.object({
  topic: z.string(),
  title: z.string(),
  about: z.string(),
  entries: z.array(SpecEntrySchema),
})

const SpecSchema = z.object({ sections: z.array(SpecSectionSchema) })

export type SpecMember = z.infer<typeof SpecMemberSchema>
export type SpecEntry = z.infer<typeof SpecEntrySchema>
export type SpecSection = z.infer<typeof SpecSectionSchema>

/** Runs the `danwo` command and returns what it printed. */
function danwo(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  })
}

/** Every section of `danwo spec`, by topic. */
export function readSpec(): Map<string, SpecSection> {
  const spec = SpecSchema.parse(JSON.parse(danwo("spec", "--json")))

  return new Map(spec.sections.map((section) => [section.topic, section]))
}

/** The folder `danwo guide` prints its guides from. */
export const GUIDES_DIR = join(REPO_ROOT, "packages", "skill", "guides")

/** The markdown of one `danwo guide`, read from the file the command prints. */
export function readGuide(topic: string): string {
  return readFileSync(join(GUIDES_DIR, `${topic}.md`), "utf8")
}

/** The repository's README. */
export function readReadme(): string {
  return readFileSync(join(REPO_ROOT, "README.md"), "utf8")
}
