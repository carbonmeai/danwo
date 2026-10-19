/** The settings page's server function: what the dashboard reads about the project. */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { settingsOf } from "./settings-data.ts"

export const fetchSettings = createServerFn({ method: "GET" }).handler(() =>
  settingsOf(projectRoot()),
)
