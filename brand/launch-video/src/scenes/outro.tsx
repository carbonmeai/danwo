import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion"

import { useCopy } from "../copy.ts"
import { clamp, ease, Mono, Sfx, typed } from "../kit.tsx"
import { C, SANS } from "../theme.ts"

const COMMAND = "npx @danwo/cli init"
const TYPE_FROM = 34

/** The end card: the lockup, the one command to start, and where to read more. */
export function Outro() {
  const frame = useCurrentFrame()
  const copy = useCopy()
  const logo = ease(frame, 4, 34)
  const pill = ease(frame, 22, 22)
  const links = ease(frame, 72, 22)
  const name = ease(frame, 92, 26)
  const out = interpolate(frame, [124, 150], [0, 1], clamp)
  const caret = Math.floor(frame / 15) % 2 === 0 ? 1 : 0

  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <Sfx name="whoosh" at={2} volume={0.35} />
      <Sfx name="typing" at={TYPE_FROM} volume={0.5} />
      <Sfx name="pop" at={TYPE_FROM + 26} volume={0.4} />
      <div
        style={{
          position: "absolute",
          left: 960 - 380,
          top: 300,
          width: 760,
          opacity: logo,
          transform: `scale(${0.92 + logo * 0.08})`,
          filter: `blur(${(1 - logo) * 18}px)`,
        }}
      >
        <Img
          src={staticFile("brand/danwo-lockup-horizontal-on-dark.svg")}
          style={{ width: "100%", display: "block" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 560,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: pill,
          transform: `translateY(${(1 - pill) * 20}px)`,
        }}
      >
        <div
          style={{
            padding: "22px 38px",
            borderRadius: 999,
            background: C.panel,
            border: `1px solid #2a2a2c`,
            minWidth: 520,
            boxShadow: "0 30px 60px rgb(0 0 0 / 0.5)",
          }}
        >
          <Mono size={36}>
            <span style={{ color: C.faint }}>$ </span>
            {typed(COMMAND, frame, TYPE_FROM, 0.8)}
            <span style={{ opacity: caret, color: C.muted }}>▍</span>
          </Mono>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 720,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: SANS,
          fontSize: 34,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: C.text,
          opacity: links,
          transform: `translateY(${(1 - links) * 14}px)`,
        }}
      >
        danwo.dev <span style={{ color: C.faint, margin: "0 18px" }}>·</span>
        <span style={{ color: C.muted }}>{copy.what}</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 800,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: SANS,
          fontSize: 26,
          color: C.faint,
          fontStyle: "italic",
          opacity: name,
        }}
      >
        {copy.name}
      </div>
    </AbsoluteFill>
  )
}
