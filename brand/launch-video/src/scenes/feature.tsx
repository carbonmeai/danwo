import type { ReactNode } from "react"
import { useCurrentFrame } from "remotion"

import { ease, Mono, Words } from "../kit.tsx"
import { C, SANS } from "../theme.ts"

/** The left column of a feature scene: a numbered kicker, the claim and a line under it. */
export function FeatureTitle({
  index,
  kicker,
  title,
  dim,
  sub,
  children,
  top = 300,
}: {
  readonly index: string
  readonly kicker: string
  readonly title: string
  readonly dim?: readonly string[]
  readonly sub: string
  readonly children?: ReactNode
  readonly top?: number
}) {
  const frame = useCurrentFrame()
  const k = ease(frame, 0, 18)
  const s = ease(frame, 16, 22)

  return (
    <div style={{ position: "absolute", left: 120, top, width: 680 }}>
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 12}px)` }}>
        <Mono
          size={22}
          color={C.faint}
          style={{ textTransform: "uppercase", letterSpacing: "0.12em" }}
        >
          {index} · {kicker}
        </Mono>
      </div>
      <Words text={title} start={4} size={76} dim={dim} style={{ marginTop: 22 }} />
      <div
        style={{
          marginTop: 26,
          fontFamily: SANS,
          fontSize: 30,
          lineHeight: 1.4,
          color: C.muted,
          letterSpacing: "-0.01em",
          opacity: s,
          transform: `translateY(${(1 - s) * 16}px)`,
          filter: `blur(${(1 - s) * 8}px)`,
        }}
      >
        {sub}
      </div>
      {children}
    </div>
  )
}
