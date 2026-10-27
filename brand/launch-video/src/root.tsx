import { Composition } from "remotion"

import { DURATION, Launch } from "./launch.tsx"
import { FPS, HEIGHT, WIDTH } from "./theme.ts"

/** The film in English (`Launch`) and in Chinese (`LaunchZh`), the same cut in each. */
export function Root() {
  return (
    <>
      <Composition
        id="Launch"
        component={Launch}
        durationInFrames={DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ lang: "en" as const }}
      />
      <Composition
        id="LaunchZh"
        component={Launch}
        durationInFrames={DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ lang: "zh" as const }}
      />
    </>
  )
}
