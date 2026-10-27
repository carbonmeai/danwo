import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion"

import { useCopy } from "../copy.ts"
import { clamp, ease, Exit, Mono, Sfx, Words } from "../kit.tsx"
import { C } from "../theme.ts"

/** The frame the music drops on, and the mark lands. */
export const DROP = 80

const LOCKUP = { width: 960, left: 480, top: 330 } as const
const SCALE = LOCKUP.width / 726.36
const TILE = 150 * SCALE

/** The danwo mark: two rounded squares on a tile. `solid` turns the tile on and inverts the squares. */
function Mark({
  size,
  draw,
  slide,
  solid,
}: {
  readonly size: number
  readonly draw: number
  readonly slide: number
  readonly solid: number
}) {
  const ink = (light: string, dark: string) => (solid > 0.5 ? dark : light)

  return (
    <svg width={size} height={size} viewBox="0 0 150 150" style={{ overflow: "visible" }}>
      <rect
        width={150}
        height={150}
        rx={36}
        fill="#fff"
        opacity={solid}
        transform={`translate(75 75) scale(${0.6 + solid * 0.4}) translate(-75 -75)`}
      />
      <g transform="translate(29 29) scale(1.4375)">
        <rect
          x={6}
          y={6}
          width={34}
          height={34}
          rx={9}
          fill="none"
          stroke={ink("#fff", C.bg)}
          strokeWidth={6}
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 * (1 - draw)}
        />
        <rect
          x={24}
          y={24}
          width={34}
          height={34}
          rx={9}
          fill={ink("#fff", C.bg)}
          stroke={ink(C.bg, "#fff")}
          strokeWidth={5}
          opacity={slide}
          transform={`translate(${(1 - slide) * 26} ${(1 - slide) * 26})`}
        />
      </g>
    </svg>
  )
}

/** The mark assembles in the quiet, lands on the drop and opens into the lockup and the tagline. */
export function Reveal() {
  const frame = useCurrentFrame()
  const copy = useCopy()
  const [drive, judge] = copy.tagline
  const draw = ease(frame, 4, 44)
  const slide = ease(frame, 34, 34)
  const solid = interpolate(frame, [DROP - 1, DROP], [0, 1], clamp)
  const settle = ease(frame, DROP + 2, 26)
  const wipe = ease(frame, DROP + 10, 30)
  const kicker = ease(frame, DROP + 16, 20)
  const burst = interpolate(frame, [DROP, DROP + 34], [0, 1], {
    ...clamp,
    easing: (t) => 1 - (1 - t) ** 3,
  })
  const breathe = 1 + Math.sin(frame / 7) * 0.012 * (1 - solid)
  const size = interpolate(settle, [0, 1], [300, TILE]) * breathe
  const cx = interpolate(settle, [0, 1], [960, LOCKUP.left + TILE / 2])
  const cy = interpolate(settle, [0, 1], [470, LOCKUP.top + 9 * SCALE + TILE / 2])
  const punch = 1 + interpolate(frame, [DROP, DROP + 4, DROP + 16], [0, 0.08, 0], clamp)

  return (
    <AbsoluteFill>
      <Sfx name="riser" at={DROP - 45} volume={0.5} />
      <Sfx name="impact" at={DROP} volume={0.75} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 44%, rgb(255 255 255 / ${0.22 * (1 - burst)}), transparent 60%)`,
        }}
      />
      <Exit at={168} duration={16}>
        <div
          style={{
            position: "absolute",
            left: 960 - 900 * burst,
            top: 470 - 900 * burst,
            width: 1800 * burst,
            height: 1800 * burst,
            borderRadius: "50%",
            border: `2px solid rgb(255 255 255 / ${0.45 * (1 - burst)})`,
            opacity: frame >= DROP ? 1 : 0,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: cx - size / 2,
            top: cy - size / 2,
            transform: `scale(${punch})`,
            filter: `drop-shadow(0 0 ${60 * (1 - settle) * solid}px rgb(255 255 255 / 0.5))`,
          }}
        >
          <Mark size={size} draw={draw} slide={slide} solid={solid} />
        </div>
        <div
          style={{
            position: "absolute",
            left: LOCKUP.left,
            top: LOCKUP.top,
            width: LOCKUP.width,
            clipPath: `inset(0 ${(1 - wipe) * 100}% 0 ${(192 / 726.36) * 100}%)`,
            transform: `translateX(${(1 - wipe) * -40}px)`,
            opacity: wipe > 0 ? 1 : 0,
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
            top: 600,
            left: 0,
            right: 0,
            textAlign: "center",
            opacity: kicker,
            transform: `translateY(${(1 - kicker) * 12}px)`,
          }}
        >
          <Mono
            size={26}
            color={C.muted}
            style={{ textTransform: "uppercase", letterSpacing: "0.12em" }}
          >
            {copy.what}
          </Mono>
        </div>
        <div style={{ position: "absolute", top: 670, left: 0, right: 0, textAlign: "center" }}>
          <Words text={drive.text} start={DROP + 22} size={84} />
          <Words text={judge.text} start={DROP + 32} size={84} color={C.muted} />
        </div>
      </Exit>
    </AbsoluteFill>
  )
}
