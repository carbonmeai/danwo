/** The feedback server function: a vote on a recording, kept in the project's `.danwo` folder. */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { feedbackOf, keepFeedback } from "./feedback-data.ts"

export const sendFeedback = createServerFn({ method: "POST" })
  .validator(feedbackOf)
  .handler(async ({ data }) => {
    await keepFeedback(projectRoot(), data)

    return { kept: true }
  })
