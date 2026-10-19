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

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined
}

/** A vote as the browser sent it, checked: a record folder, and up or down. */
export function feedbackOf(value: unknown): Feedback {
  const record = field(value, "record")
  const vote = field(value, "vote")

  if (typeof record === "string" && (vote === "up" || vote === "down")) return { record, vote }

  throw new Error("feedback needs a record and an up or down vote")
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
