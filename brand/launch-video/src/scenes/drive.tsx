import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion"

import { Card, Chip, ease, Exit, Mono, Sfx } from "../kit.tsx"
import { C } from "../theme.ts"
import { FeatureTitle } from "./feature.tsx"

const KEY = "#ff7b72"
const STR = "#a5d6ff"
const FN = "#d2a8ff"
const TXT = "#e6edf3"

/** The test, as coloured runs of text, one array per line. */
const CODE: readonly (readonly (readonly [string, string])[])[] = [
  [
    ["test", FN],
    ["(", TXT],
    ['"buys 500 credits"', STR],
    [", ", TXT],
    ["async", KEY],
    [" ({ page, agent }) => {", TXT],
  ],
  [
    ["  await", KEY],
    [" page.", TXT],
    ["goto", FN],
    ["(", TXT],
    ['"/"', STR],
    [")", TXT],
  ],
  [
    ["  await", KEY],
    [" ", TXT],
    ["agent", FN],
    ["(", TXT],
    ['"buy 500 credits with a test card"', STR],
    [")", TXT],
  ],
  [
    ["  await", KEY],
    [" ", TXT],
    ["expect", FN],
    ["(page.", TXT],
    ["getByText", FN],
    ["(", TXT],
    ['"Credits: 500"', STR],
    [")).", TXT],
    ["toBeVisible", FN],
    ["()", TXT],
  ],
  [["})", TXT]],
]

const TYPE_FROM = 16
const PER_FRAME = 2.4
const AGENT_LINE = 2

/** The test file typed into an editor, a character budget at a time. */
function Editor() {
  const frame = useCurrentFrame()
  let budget = Math.max(0, Math.floor((frame - TYPE_FROM) * PER_FRAME))
  const lit = ease(frame, 96, 16)

  return (
    <div style={{ padding: "36px 0" }}>
      {CODE.map((line, i) => {
        const runs = line.map(([text, color], j) => {
          const shown = text.slice(0, budget)

          budget -= shown.length

          return (
            <span key={j} style={{ color }}>
              {shown}
            </span>
          )
        })

        return (
          <div
            key={i}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              height: 50,
              padding: "0 40px",
              background: i === AGENT_LINE ? `rgb(59 130 246 / ${0.13 * lit})` : undefined,
              boxShadow: i === AGENT_LINE ? `inset 3px 0 0 rgb(59 130 246 / ${lit})` : undefined,
            }}
          >
            <Mono size={20} color={C.faint} style={{ width: 40 }}>
              {i + 1}
            </Mono>
            <Mono size={24} style={{ whiteSpace: "pre" }}>
              {runs}
            </Mono>
          </div>
        )
      })}
    </div>
  )
}

/** Feature one: it drives the app, with locators, plain-English agent steps, or both. */
export function Drive() {
  const frame = useCurrentFrame()
  const enter = ease(frame, 6, 26)
  const tag = ease(frame, 100, 16)
  const replay = ease(frame, 112, 18)
  const chips = [ease(frame, 30, 18), ease(frame, 36, 18), ease(frame, 42, 18)]

  return (
    <AbsoluteFill>
      <Sfx name="whoosh" at={2} volume={0.3} />
      <Sfx name="typing" at={TYPE_FROM} volume={0.55} />
      <Sfx name="typing" at={TYPE_FROM + 44} volume={0.45} />
      <Sfx name="pop" at={100} volume={0.45} />
      <Exit at={138} duration={12}>
        <FeatureTitle
          index="01"
          kicker="Drive"
          title="It drives the app like a user."
          dim={["It", "the", "like", "a"]}
          sub="In a browser or on an iOS or Android device, with locators, plain-English agent steps, or both."
        >
          <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
            {[
              ["playwright.svg", "Browser"],
              ["apple-on-dark.svg", "iOS"],
              ["android.svg", "Android"],
            ].map(([icon, label], i) => (
              <div
                key={label}
                style={{
                  opacity: chips[i],
                  transform: `translateY(${(1 - (chips[i] ?? 0)) * 14}px)`,
                }}
              >
                <Chip>
                  <Img src={staticFile(`icons/${icon}`)} style={{ width: 30, height: 30 }} />
                  {label}
                </Chip>
              </div>
            ))}
          </div>
        </FeatureTitle>
        <div
          style={{
            position: "absolute",
            left: 860,
            top: 300,
            width: 980,
            opacity: enter,
            transform: `perspective(2000px) rotateY(${(1 - enter) * -14}deg) translateX(${(1 - enter) * 80}px)`,
          }}
        >
          <Card>
            <div
              style={{
                height: 54,
                display: "flex",
                alignItems: "center",
                padding: "0 24px",
                borderBottom: `1px solid ${C.line}`,
                background: C.raised,
              }}
            >
              <Mono size={19} color={C.muted}>
                tests/buy-credits.danwo.ts
              </Mono>
            </div>
            <Editor />
          </Card>
          <div
            style={{
              position: "absolute",
              right: 36,
              top: 54 + 36 + 50 * AGENT_LINE + 8,
              opacity: tag,
              transform: `translateX(${(1 - tag) * 20}px)`,
            }}
          >
            <Mono
              size={17}
              color="#93c5fd"
              style={{ padding: "6px 12px", borderRadius: 8, background: "rgb(59 130 246 / 0.18)" }}
            >
              agent step
            </Mono>
          </div>
          <div
            style={{
              marginTop: 28,
              opacity: replay,
              transform: `translateY(${(1 - replay) * 18}px)`,
            }}
          >
            <Chip style={{ fontSize: 28 }}>
              <span style={{ color: C.pass }}>●</span>
              Recorded once. Replayed with no model calls.
            </Chip>
          </div>
        </div>
      </Exit>
    </AbsoluteFill>
  )
}
