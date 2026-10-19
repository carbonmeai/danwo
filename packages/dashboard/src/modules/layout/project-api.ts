/** The project the dashboard shows, by its folder's name only, for the sidebar. */
import { basename } from "node:path"

import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"

export const fetchProject = createServerFn({ method: "GET" }).handler(() => ({
  name: basename(projectRoot()),
}))
