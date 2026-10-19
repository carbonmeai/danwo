/**
 * Video of a device attempt: the screen filmed from just before the app starts until the attempt
 * closes, saved as `video/screen.mp4` in the attempt's directory.
 */
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { type CapturedVideo, VIDEO_DIR } from "../record/video.ts"
import type { DeviceTarget } from "./types.ts"

/** A device attempt's film, while it runs and once it stopped. */
export interface DeviceFilm {
  /** Stops filming and keeps the file; never throws. */
  stop(): Promise<void>
  /** The saved video, after `stop`. */
  videos(): readonly CapturedVideo[]
}

const FILE = `${VIDEO_DIR}/screen.mp4`

/** Starts filming `target`'s screen into `dir`; undefined when the device cannot film. */
export async function startDeviceFilm(
  target: DeviceTarget,
  dir: string,
): Promise<DeviceFilm | undefined> {
  if (target.recordScreen === undefined) return undefined

  await mkdir(join(dir, VIDEO_DIR), { recursive: true })

  const film = await target.recordScreen(join(dir, FILE)).catch(() => undefined)

  if (film === undefined) return undefined

  let saved: CapturedVideo[] = []

  return {
    async stop() {
      const stoppedAt = Date.now()

      if (!(await film.stop().catch(() => false))) return

      saved = [
        {
          file: FILE,
          startedAt: new Date(film.startedAt).toISOString(),
          durationMs: Math.max(stoppedAt - film.startedAt, 0),
          tab: 1,
        },
      ]
    },
    videos: () => saved,
  }
}
