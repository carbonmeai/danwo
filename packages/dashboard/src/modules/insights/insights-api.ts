/** The insights page's server function: it reads the run history and never writes. */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { getInsights } from "./insights-data.ts"

export const fetchInsights = createServerFn({ method: "GET" }).handler(() =>
  getInsights(projectRoot()),
)
