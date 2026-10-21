import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"

import { Card, Chip, clamp, Cursor, ease, Exit, Mono, Sfx, Words } from "../kit.tsx"
import { C, SANS } from "../theme.ts"

const CLICK = 30
const QUESTIONS = [
  "Was the card charged once?",
  "Did the webhook arrive?",
  "Was the email sent?",
  "Does the ledger add up?",
] as const

/** The page a passing test sees: a checkout before the click, a thank-you after it. */
function Shop({ paid }: { readonly paid: boolean }) {
  const frame = useCurrentFrame()
  const done = ease(frame, CLICK + 4, 16)

  return (
    <div style={{ position: "relative", height: 480, fontFamily: SANS }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: "56px 64px",
          opacity: 1 - done,
          transform: `translateY(${-done * 20}px)`,
        }}
      >
        <div style={{ fontSize: 22, color: C.muted, fontWeight: 500 }}>Checkout</div>
        <div
          style={{
            fontSize: 52,
            color: C.text,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            marginTop: 8,
          }}
        >
          500 credits
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 48,
            fontSize: 26,
            color: C.muted,
          }}
        >
          <span>Total</span>
          <span style={{ color: C.text, fontWeight: 600 }}>$5.00</span>
        </div>
        <div style={{ height: 1, background: C.line, margin: "28px 0 40px" }} />
        <div
          style={{
            height: 76,
            borderRadius: 14,
            background: "#fff",
            color: "#0a0a0a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontWeight: 600,
            transform: `scale(${paid ? 0.97 : 1})`,
          }}
        >
          Pay $5.00
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: done,
          transform: `scale(${0.94 + done * 0.06})`,
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 999,
            background: "rgb(34 197 94 / 0.14)",
            border: `2px solid ${C.pass}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width={48} height={48} viewBox="0 0 24 24">
            <path
              d="M5 12.5 L10 17.5 L19 7"
              fill="none"
              stroke={C.pass}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={24}
              strokeDashoffset={24 * (1 - ease(frame, CLICK + 10, 16))}
            />
          </svg>
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 600,
            color: C.text,
            marginTop: 32,
            letterSpacing: "-0.03em",
          }}
        >
          Thank you for your purchase
        </div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 12 }}>Credits: 500</div>
      </div>
    </div>
  )
}

/** A test clicks Pay and passes; then the questions it never asked. */
export function Proof() {
  const frame = useCurrentFrame()
  const enter = ease(frame, 0, 24)
  const aside = ease(frame, 64, 28)
  const travel = ease(frame, 8, 22)
  const press = interpolate(frame, [CLICK - 2, CLICK, CLICK + 5], [0, 1, 0], clamp)
  const pass = ease(frame, CLICK + 18, 14)

  return (
    <AbsoluteFill>
      <Sfx name="whoosh" at={0} volume={0.35} />
      <Sfx name="click" at={CLICK} volume={0.8} />
      <Sfx name="pop" at={CLICK + 8} volume={0.5} />
      {QUESTIONS.map((_, i) => (
        <Sfx key={i} name="tick" at={74 + i * 9} volume={0.45} />
      ))}
      <Exit at={134} duration={13}>
        <Exit at={60} duration={10} lift={20}>
          <div style={{ position: "absolute", top: 110, left: 0, right: 0, textAlign: "center" }}>
            <Words
              text="A test clicks Pay and sees “Thank you.”"
              start={2}
              size={60}
              dim={["A", "test", "and", "sees"]}
            />
          </div>
        </Exit>
        <div style={{ position: "absolute", top: 110, left: 0, right: 0, textAlign: "center" }}>
          <Words
            text="But did everything behind it work?"
            start={70}
            size={60}
            dim={["But", "did", "behind", "it"]}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: 530,
            top: 250,
            width: 860,
            opacity: enter,
            transform: `translateX(${-aside * 330}px) translateY(${(1 - enter) * 40 + aside * 30}px) scale(${(0.94 + enter * 0.06) * (1 - aside * 0.2)})`,
          }}
        >
          <Card>
            <div
              style={{
                height: 56,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0 22px",
                borderBottom: `1px solid ${C.line}`,
                background: C.raised,
              }}
            >
              {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
                <span
                  key={color}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 99,
                    background: color,
                    opacity: 0.85,
                  }}
                />
              ))}
              <div
                style={{
                  marginLeft: 20,
                  flex: 1,
                  height: 32,
                  borderRadius: 8,
                  background: C.bg,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 16,
                }}
              >
                <Mono size={18} color={C.muted}>
                  localhost:3000/checkout
                </Mono>
              </div>
            </div>
            <Shop paid={frame >= CLICK && frame < CLICK + 5} />
          </Card>
          <div
            style={{
              position: "absolute",
              right: -24,
              top: -26,
              opacity: pass,
              transform: `scale(${0.8 + pass * 0.2})`,
            }}
          >
            <Chip style={{ color: C.pass, borderColor: "rgb(34 197 94 / 0.4)" }}>
              <span style={{ fontWeight: 700 }}>✓</span> test passed
            </Chip>
          </div>
        </div>
        {frame < CLICK + 30 && (
          <div style={{ opacity: 1 - ease(frame, CLICK + 12, 12) }}>
            <Cursor
              x={interpolate(travel, [0, 1], [1420, 1010])}
              y={interpolate(travel, [0, 1], [960, 630])}
              press={press}
            />
          </div>
        )}
        {QUESTIONS.map((question, i) => {
          const p = ease(frame, 74 + i * 9, 20)

          return (
            <div
              key={question}
              style={{
                position: "absolute",
                left: 1070,
                top: 330 + i * 112,
                opacity: p,
                transform: `translateX(${(1 - p) * 60}px)`,
                filter: `blur(${(1 - p) * 10}px)`,
              }}
            >
              <Chip style={{ fontSize: 32, padding: "18px 28px" }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 99,
                    background: "rgb(245 158 11 / 0.16)",
                    color: "#f5b544",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    fontWeight: 700,
                  }}
                >
                  ?
                </span>
                {question}
              </Chip>
            </div>
          )
        })}
      </Exit>
    </AbsoluteFill>
  )
}
