/** The impact page's server function: it reads `.danwo/impact.json` and never writes. */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { getImpact } from "./impact-data.ts"

export const fetchImpact = createServerFn({ method: "GET" }).handler(() => getImpact(projectRoot()))
