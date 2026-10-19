/** The overview's server function: it reads the project's history and hands the page its figures. */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { loadHistory } from "../runs/runs-data.ts"
import { type Range, overviewOf } from "./overview-data.ts"

export const fetchOverview = createServerFn({ method: "GET" })
  .validator((range: Range) => range)
  .handler(async ({ data }) => overviewOf(await loadHistory(projectRoot()), data))
