/**
 * Whether a recording was useful to whoever read it, kept in the project's `.danwo/feedback.jsonl`
 * as one line per vote. Nothing leaves the machine.
 */
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

import { danwoDir, insideArea } from "../../lib/project-files.ts"

/** A vote on one recording. */
export interface Feedback {
  readonly record: string
  readonly vote: "up" | "down"
}

/** Appends the vote, refusing a record outside the project's run folders. */
export async function keepFeedback(
  root: string,
  feedback: Feedback,
  now = new Date(),
): Promise<void> {
  insideArea(root, "runs", feedback.record)

  await mkdir(danwoDir(root), { recursive: true })
  await appendFile(
    join(danwoDir(root), "feedback.jsonl"),
    `${JSON.stringify({ at: now.toISOString(), ...feedback })}\n`,
  )
}
