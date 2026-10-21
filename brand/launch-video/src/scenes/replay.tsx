import { OffthreadVideo, staticFile, useCurrentFrame } from "remotion"

import { Mono } from "../kit.tsx"
import { C, FPS } from "../theme.ts"

const LENGTH = 31.8
const FROM = 1
const RATE = 2
const STEPS = [0.06, 0.14, 0.27, 0.41, 0.55, 0.7, 0.86] as const

/** A run's replay in danwo's player: a real recording of Impulse's onboarding, playing at 2×. */
export function Replay() {
  const frame = useCurrentFrame()
  const at = FROM + (frame / FPS) * RATE
  const progress = at / LENGTH

  return (
    <div style={{ background: C.panel }}>
      <div style={{ padding: 10, paddingBottom: 0 }}>
        <div style={{ borderRadius: 8, overflow: "hidden", aspectRatio: "16 / 9" }}>
          <OffthreadVideo
            src={staticFile("replay/impulse-onboarding.mp4")}
            trimBefore={FROM * FPS}
            playbackRate={RATE}
            muted
            style={{ width: "100%", display: "block" }}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
          }}
        >
          <span style={{ width: 3, height: 9, background: C.bg, borderRadius: 1 }} />
          <span style={{ width: 3, height: 9, background: C.bg, borderRadius: 1 }} />
        </div>
        <Mono size={11} color={C.muted}>
          0:{at.toFixed(1).padStart(4, "0")} / 0:{LENGTH.toFixed(1)}
        </Mono>
        <div
          style={{
            position: "relative",
            flex: 1,
            height: 4,
            borderRadius: 4,
            background: "rgb(255 255 255 / 0.1)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${progress * 100}%`,
              borderRadius: 4,
              background: C.blue,
            }}
          />
          {STEPS.map((step) => (
            <span
              key={step}
              style={{
                position: "absolute",
                left: `${step * 100}%`,
                top: -3,
                width: 2,
                height: 10,
                borderRadius: 1,
                background: step <= progress ? "#93c5fd" : "rgb(255 255 255 / 0.3)",
              }}
            />
          ))}
        </div>
        {["1×", "2×", "4×"].map((speed) => (
          <Mono
            key={speed}
            size={10}
            color={speed === "2×" ? C.bg : C.muted}
            style={{
              padding: "3px 6px",
              borderRadius: 5,
              background: speed === "2×" ? "#fff" : "rgb(255 255 255 / 0.06)",
            }}
          >
            {speed}
          </Mono>
        ))}
      </div>
    </div>
  )
}
