import { AbsoluteFill, useCurrentFrame } from "remotion"

import { ease, Exit, Words } from "../kit.tsx"
import { C } from "../theme.ts"

/** Two lines: what coding agents changed, and what that left behind. */
export function Hook() {
  const frame = useCurrentFrame()
  const lift = ease(frame, 58, 26)

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Exit at={124} duration={14}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              transform: `translateY(${-lift * 70}px) scale(${1 - lift * 0.18})`,
              opacity: 1 - lift * 0.55,
            }}
          >
            <Words text="Coding agents made code cheap." start={6} size={104} />
          </div>
          <div style={{ position: "absolute", top: 548, left: 0, right: 0, textAlign: "center" }}>
            <Words
              text="Checking it is the bottleneck."
              start={66}
              size={104}
              color={C.text}
              dim={["Checking", "it", "is", "the"]}
            />
          </div>
        </AbsoluteFill>
      </Exit>
    </AbsoluteFill>
  )
}
