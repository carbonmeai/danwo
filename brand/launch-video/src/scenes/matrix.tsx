import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"

import { useCopy } from "../copy.ts"
import { Card, clamp, ease, Exit, Mono, Sfx } from "../kit.tsx"
import { C } from "../theme.ts"
import { FeatureTitle } from "./feature.tsx"

const FAULTS = [
  "500",
  "429",
  "timeout",
  "reset",
  "delay",
  "duplicate",
  "forged",
  "stale",
  "double-submit",
  "time jump",
] as const
const ROWS = [
  "POST api.stripe.com/v1/checkout",
  "GET checkout.stripe.com/:id",
  "webhook checkout.session.completed",
  "POST resend.com/emails",
  "POST /buy",
  "db commit",
] as const

/** Which faults apply to which row; the rest of the grid stays empty. */
const APPLIES: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 7],
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 2, 4],
  [8],
  [3, 9],
]

const BROKEN = { row: 2, col: 5 } as const
const CELL = 46
const GAP = 8
const FILL_FROM = 26
const FAIL_AT = 92

/** Feature three: one clean run, replayed once per fault, an invariant judging each trial. */
export function Matrix() {
  const frame = useCurrentFrame()
  const copy = useCopy().matrix
  const enter = ease(frame, 6, 26)
  const fail = ease(frame, FAIL_AT, 12)
  const detail = ease(frame, FAIL_AT + 10, 22)
  const shake =
    Math.sin(frame * 2.2) * 7 * interpolate(frame, [FAIL_AT, FAIL_AT + 14], [1, 0], clamp)
  const order = APPLIES.flatMap((cols, row) => cols.map((col) => ({ row, col }))).toSorted(
    (a, b) => a.col + a.row - (b.col + b.row),
  )

  return (
    <AbsoluteFill>
      <Sfx name="whoosh" at={2} volume={0.3} />
      {order.map((_, i) =>
        i % 4 === 0 ? <Sfx key={i} name="tick" at={FILL_FROM + i * 2.4} volume={0.28} /> : null,
      )}
      <Sfx name="error" at={FAIL_AT} volume={0.6} />
      <Exit at={152} duration={13}>
        <FeatureTitle index="03" feature={copy} top={280} />
        <div
          style={{
            position: "absolute",
            left: 860,
            top: 210,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 40}px) scale(${0.96 + enter * 0.04})`,
          }}
        >
          <Card style={{ padding: "30px 36px 36px" }}>
            <Mono size={20} color={C.muted}>
              <span style={{ color: C.faint }}>$ </span>danwo matrix tests/buy-credits.danwo.ts
            </Mono>
            <div style={{ display: "flex", marginTop: 26 }}>
              <div style={{ width: 380, paddingTop: 130 }}>
                {ROWS.map((row) => (
                  <div
                    key={row}
                    style={{ height: CELL + GAP, display: "flex", alignItems: "center" }}
                  >
                    <Mono
                      size={17}
                      color={C.muted}
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        width: 360,
                      }}
                    >
                      {row}
                    </Mono>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", gap: GAP, height: 130, alignItems: "flex-end" }}>
                  {FAULTS.map((fault) => (
                    <div
                      key={fault}
                      style={{
                        width: CELL,
                        display: "flex",
                        justifyContent: "center",
                        paddingBottom: 12,
                      }}
                    >
                      <Mono
                        size={16}
                        color={C.faint}
                        style={{
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fault}
                      </Mono>
                    </div>
                  ))}
                </div>
                {ROWS.map((row, r) => (
                  <div key={row} style={{ display: "flex", gap: GAP, height: CELL + GAP }}>
                    {FAULTS.map((fault, c) => {
                      const index = order.findIndex((cell) => cell.row === r && cell.col === c)
                      const p = index < 0 ? 0 : ease(frame, FILL_FROM + index * 2.4, 10)
                      const broken = r === BROKEN.row && c === BROKEN.col
                      const color = broken && fail > 0 ? C.fail : C.pass

                      return (
                        <div
                          key={fault}
                          style={{
                            width: CELL,
                            height: CELL,
                            borderRadius: 9,
                            background: "rgb(255 255 255 / 0.05)",
                            position: "relative",
                            transform: broken ? `translateX(${shake}px)` : undefined,
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              borderRadius: 9,
                              background: color,
                              opacity: p,
                              transform: `scale(${0.5 + p * 0.5})`,
                              boxShadow: broken
                                ? `0 0 ${30 * fail}px rgb(240 82 82 / 0.8), 0 0 0 ${3 * fail}px #fff`
                                : undefined,
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <div
            style={{
              position: "absolute",
              left: 340,
              top: 520,
              width: 600,
              opacity: detail,
              transform: `translateY(${(1 - detail) * 30}px)`,
              filter: `blur(${(1 - detail) * 8}px)`,
            }}
          >
            <Card style={{ padding: "26px 30px", borderColor: "rgb(240 82 82 / 0.35)" }}>
              <Mono size={18} color={C.fail}>
                ● failed · App bug
              </Mono>
              <div style={{ marginTop: 12 }}>
                <Mono size={22}>duplicate on webhook checkout.session.completed</Mono>
              </div>
              <div
                style={{
                  marginTop: 16,
                  padding: "14px 18px",
                  borderRadius: 12,
                  background: "rgb(240 82 82 / 0.12)",
                }}
              >
                <Mono size={20} color="#fca5a5">
                  invariant: expected 1000 to be 500
                </Mono>
              </div>
            </Card>
          </div>
        </div>
      </Exit>
    </AbsoluteFill>
  )
}
