import { Composition } from "remotion"

import { DURATION, Launch } from "./launch.tsx"
import { FPS, HEIGHT, WIDTH } from "./theme.ts"

export function Root() {
  return (
    <Composition
      id="Launch"
      component={Launch}
      durationInFrames={DURATION}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  )
}
