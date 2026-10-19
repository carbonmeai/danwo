/**
 * Whether a recording was useful to whoever read it, kept in the project's `.danwo/feedback.jsonl`
 * as one line per vote. Nothing leaves the machine.
 */
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

import { createServerFn } from "@tanstack/react-start"

import { danwoDir, insideArea, projectRoot } from "../../lib/project-files.ts"

/** A vote on one recording. */
interface Feedback {
  readonly record: string
  readonly vote: "up" | "down"
}

function feedbackOf(value: unknown): Feedback {
  const record = typeof value === "object" && value !== null ? Reflect.get(value, "record") : null
  const vote = typeof value === "object" && value !== null ? Reflect.get(value, "vote") : null

  if (typeof record !== "string" || (vote !== "up" && vote !== "down"))
    throw new Error("feedback needs a record and an up or down vote")

  return { record, vote }
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

export const sendFeedback = createServerFn({ method: "POST" })
  .validator(feedbackOf)
  .handler(async ({ data }) => {
    await keepFeedback(projectRoot(), data)

    return { kept: true }
  })
