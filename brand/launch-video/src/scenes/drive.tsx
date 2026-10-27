import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion"

import { type Copy, useCopy } from "../copy.ts"
import { Card, Chip, ease, Exit, Mono, Sfx } from "../kit.tsx"
import { C } from "../theme.ts"
import { FeatureTitle } from "./feature.tsx"

const KEY = "#ff7b72"
const STR = "#a5d6ff"
const FN = "#d2a8ff"
const TXT = "#e6edf3"

/** The test, as coloured runs of text, one array per line; its strings in the cut's language. */
const codeOf = (copy: Copy["drive"]): readonly (readonly (readonly [string, string])[])[] => [
  [
    ["test", FN],
    ["(", TXT],
    [copy.testName, STR],
    [", ", TXT],
    ["async", KEY],
    [" ({ app, agent, screen, expect }) => {", TXT],
  ],
  [
    ["  await", KEY],
    [" app.", TXT],
    ["open", FN],
    ["(", TXT],
    ['"/"', STR],
    [")", TXT],
  ],
  [
    ["  await", KEY],
    [" agent.", TXT],
    ["act", FN],
    ["(", TXT],
    [copy.agentStep, STR],
    [")", TXT],
  ],
  [
    ["  await", KEY],
    [" ", TXT],
    ["expect", FN],
    ["(screen.", TXT],
    ["getByText", FN],
    ["(", TXT],
    [copy.creditsShown, STR],
    [")).", TXT],
    ["toBeVisible", FN],
    ["()", TXT],
  ],
  [["})", TXT]],
]

const TYPE_FROM = 16
const PER_FRAME = 2.6
const AGENT_LINE = 2

/** The test file typed into an editor, a character budget at a time. */
function Editor() {
  const frame = useCurrentFrame()
  const code = codeOf(useCopy().drive)
  let budget = Math.max(0, Math.floor((frame - TYPE_FROM) * PER_FRAME))
  const lit = ease(frame, 96, 16)

  return (
    <div style={{ padding: "36px 0" }}>
      {code.map((line, i) => {
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
            <Mono size={22} style={{ whiteSpace: "pre" }}>
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
  const copy = useCopy().drive
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
        <FeatureTitle index="01" feature={copy}>
          <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
            {(["playwright.svg", "apple-on-dark.svg", "android.svg"] as const).map((icon, i) => (
              <div
                key={icon}
                style={{
                  opacity: chips[i],
                  transform: `translateY(${(1 - (chips[i] ?? 0)) * 14}px)`,
                }}
              >
                <Chip>
                  <Img src={staticFile(`icons/${icon}`)} style={{ width: 30, height: 30 }} />
                  {copy.targets[i]}
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
              {copy.agentTag}
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
              {copy.replayed}
            </Chip>
          </div>
        </div>
      </Exit>
    </AbsoluteFill>
  )
}
