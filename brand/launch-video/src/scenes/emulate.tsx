import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion"

import { useCopy } from "../copy.ts"
import { Chip, ease, Exit, Mono, Sfx } from "../kit.tsx"
import { C, SANS } from "../theme.ts"
import { FeatureTitle } from "./feature.tsx"

const ICONS = [
  "stripe.svg",
  "resend.svg",
  "s3.svg",
  "google.svg",
  "slack.svg",
  "github.svg",
  "clerk.svg",
  "auth0.svg",
  "openai.svg",
  "anthropic.svg",
  "microsoft.svg",
  "pusher.svg",
  "novu.svg",
  "composio.svg",
  "twilio.svg",
  "tiptap.png",
] as const

const CX = 1330
const CY = 560
const RADIUS = 380
const TILE = 96
const PROXY = 200

/** Feature two: every service behind the app answers from a local emulator behind danwo's proxy. */
export function Emulate() {
  const frame = useCurrentFrame()
  const copy = useCopy().emulate
  const core = ease(frame, 4, 24)
  const spin = frame * 0.09

  const spots = ICONS.map((icon, i) => {
    const angle = ((i / ICONS.length) * 360 + spin - 90) * (Math.PI / 180)

    return {
      icon,
      x: CX + Math.cos(angle) * RADIUS,
      y: CY + Math.sin(angle) * RADIUS,
      p: ease(frame, 12 + i * 3, 20),
    }
  })

  return (
    <AbsoluteFill>
      <Sfx name="whoosh" at={2} volume={0.3} />
      {[0, 4, 8, 12].map((n) => (
        <Sfx key={n} name="tick" at={12 + n * 3} volume={0.3} />
      ))}
      <Exit at={152} duration={13}>
        <FeatureTitle index="02" feature={copy}>
          <div style={{ marginTop: 40, opacity: ease(frame, 70, 18) }}>
            <Chip>
              <span style={{ color: C.pass }}>✓</span> {copy.checked}
            </Chip>
          </div>
        </FeatureTitle>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <circle
            cx={CX}
            cy={CY}
            r={RADIUS}
            fill="none"
            stroke="rgb(255 255 255 / 0.06)"
            strokeWidth={1.5}
            opacity={core}
          />
          <circle
            cx={CX}
            cy={CY}
            r={PROXY}
            fill="none"
            stroke="rgb(255 255 255 / 0.22)"
            strokeWidth={1.5}
            strokeDasharray="6 9"
            strokeDashoffset={-frame * 0.6}
            opacity={core}
          />
          {spots.map(({ x, y, p }, i) => {
            const t = ((frame * 1.6 + i * 23) % 90) / 90
            const out = i % 2 === 0
            const k = out ? t : 1 - t
            const dx = x - CX
            const dy = y - CY
            const len = Math.hypot(dx, dy)
            const sx = CX + (dx / len) * PROXY
            const sy = CY + (dy / len) * PROXY

            return (
              <g key={i} opacity={p}>
                <line
                  x1={sx}
                  y1={sy}
                  x2={x}
                  y2={y}
                  stroke="rgb(255 255 255 / 0.1)"
                  strokeWidth={1.5}
                />
                <circle
                  cx={sx + (x - sx) * k}
                  cy={sy + (y - sy) * k}
                  r={4}
                  fill={out ? C.blue : C.pass}
                  opacity={Math.sin(t * Math.PI) * ease(frame, 40, 20)}
                />
              </g>
            )
          })}
        </svg>
        <div
          style={{
            position: "absolute",
            left: CX - 150,
            top: CY - 110,
            width: 300,
            height: 220,
            borderRadius: 22,
            background: C.raised,
            border: `1px solid rgb(255 255 255 / 0.16)`,
            boxShadow: "0 0 80px rgb(255 255 255 / 0.08), 0 30px 60px rgb(0 0 0 / 0.6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: core,
            transform: `scale(${0.85 + core * 0.15})`,
          }}
        >
          <Img
            src={staticFile("brand/danwo-mark-on-dark.svg")}
            style={{ width: 64, height: 64, marginBottom: 6 }}
          />
          <div
            style={{
              fontFamily: SANS,
              fontSize: 34,
              fontWeight: 600,
              color: C.text,
              letterSpacing: "-0.03em",
            }}
          >
            {copy.app}
          </div>
          <Mono size={18} color={C.muted}>
            {copy.through}
          </Mono>
        </div>
        {spots.map(({ icon, x, y, p }) => (
          <div
            key={icon}
            style={{
              position: "absolute",
              left: x - TILE / 2,
              top: y - TILE / 2,
              width: TILE,
              height: TILE,
              borderRadius: 26,
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 18px 40px rgb(0 0 0 / 0.55)",
              opacity: p,
              transform: `scale(${0.4 + p * 0.6})`,
              filter: `blur(${(1 - p) * 8}px)`,
            }}
          >
            <Img
              src={staticFile(`icons/${icon}`)}
              style={{ width: 50, height: 50, objectFit: "contain" }}
            />
          </div>
        ))}
      </Exit>
    </AbsoluteFill>
  )
}
