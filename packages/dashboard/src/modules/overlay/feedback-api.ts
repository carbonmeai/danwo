/** The feedback server function: a vote on a recording, kept in the project's `.danwo` folder. */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { type Feedback, keepFeedback } from "./feedback-data.ts"

function feedbackOf(value: unknown): Feedback {
  const record = typeof value === "object" && value !== null ? Reflect.get(value, "record") : null
  const vote = typeof value === "object" && value !== null ? Reflect.get(value, "vote") : null

  if (typeof record !== "string" || (vote !== "up" && vote !== "down"))
    throw new Error("feedback needs a record and an up or down vote")

  return { record, vote }
}

export const sendFeedback = createServerFn({ method: "POST" })
  .validator(feedbackOf)
  .handler(async ({ data }) => {
    await keepFeedback(projectRoot(), data)

    return { kept: true }
  })
