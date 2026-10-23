import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion"

import { Chip, ease, Exit, Sfx } from "../kit.tsx"
import { C } from "../theme.ts"
import { FeatureTitle } from "./feature.tsx"
import { Replay } from "./replay.tsx"

/**
 * The wall's columns: real screenshots of danwo's dashboard, PR comment and terminal, and a live
 * replay. The PR comment is cropped to its header so the matrix and the replay lead.
 */
const COLUMNS: readonly {
  readonly width: number
  readonly offset: number
  readonly tiles: readonly string[]
}[] = [
  { width: 420, offset: 160, tiles: ["breaks", "overview", "verdict"] },
  { width: 330, offset: -120, tiles: ["trial", "verdict"] },
  { width: 520, offset: 40, tiles: ["pr-comment", "matrix", "replay"] },
  { width: 520, offset: -60, tiles: ["providers", "terminal"] },
  { width: 520, offset: 200, tiles: ["calls", "breaks"] },
]

const OUTLETS = [["github-on-dark.svg", "GitHub Check & PR comment"]] as const

/** Feature four: the flight record, shown as a wall of the UI it renders into. */
export function Explain() {
  const frame = useCurrentFrame()
  const enter = ease(frame, 0, 30)
  const pan = frame * 2.2

  return (
    <AbsoluteFill>
      <Sfx name="whoosh" at={2} volume={0.35} />
      <Exit at={78} duration={12}>
        <div
          style={{
            position: "absolute",
            inset: "0 0 0 640px",
            overflow: "hidden",
            opacity: enter,
            maskImage:
              "linear-gradient(to right, transparent 0, #000 22%, #000 88%, transparent 100%), linear-gradient(to bottom, transparent 0, #000 14%, #000 86%, transparent 100%)",
            maskComposite: "intersect",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              display: "flex",
              gap: 26,
              alignItems: "flex-start",
              transformOrigin: "0 0",
              transform: `translate(${-720 - pan * 0.45 + (1 - enter) * 120}px, ${780 - pan * 0.26}px) rotate(-30deg) skewX(30deg) scaleY(0.866)`,
            }}
          >
            {COLUMNS.map((column, i) => (
              <div
                key={i}
                style={{
                  width: column.width,
                  marginTop: column.offset,
                  display: "flex",
                  flexDirection: "column",
                  gap: 26,
                }}
              >
                {column.tiles.map((tile, j) => (
                  <div
                    key={j}
                    style={{
                      borderRadius: 18,
                      overflow: "hidden",
                      border: "1px solid rgb(255 255 255 / 0.12)",
                      boxShadow: "0 40px 80px rgb(0 0 0 / 0.6)",
                      background: C.bg,
                      height: tile === "pr-comment" ? 210 : undefined,
                    }}
                  >
                    {tile === "replay" ? (
                      <Replay />
                    ) : (
                      <Img
                        src={staticFile(`tiles/${tile}.png`)}
                        style={{ display: "block", width: "100%" }}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(to right, ${C.bg} 0%, ${C.bg} 32%, transparent 48%)`,
          }}
        />
        <FeatureTitle
          index="04"
          kicker="Flight record"
          title="It explains every run."
          dim={["It", "every", "run."]}
          sub="The video, each step, every provider call and webhook, the database statements, with secrets redacted."
          top={290}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 14,
              marginTop: 40,
            }}
          >
            {OUTLETS.map(([icon, label], i) => {
              const p = ease(frame, 30 + i * 8, 18)

              return (
                <div key={label} style={{ opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
                  <Chip>
                    <Img src={staticFile(`icons/${icon}`)} style={{ width: 28, height: 28 }} />
                    {label}
                  </Chip>
                </div>
              )
            })}
          </div>
        </FeatureTitle>
      </Exit>
    </AbsoluteFill>
  )
}
