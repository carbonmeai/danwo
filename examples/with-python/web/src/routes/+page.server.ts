import { read } from "#lib/server/api.ts"
import type { StudioClass } from "#lib/studio.ts"

import type { PageServerLoad } from "./$types"

/** The timetable: the week's classes, read from the API on the server. */
export const load: PageServerLoad = async () => ({
  classes: await read<StudioClass[]>("/classes"),
})
