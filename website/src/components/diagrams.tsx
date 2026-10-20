/**
 * Diagrams the docs pages draw inline: how a test's requests reach danwo's emulators, and how a
 * fault matrix turns one clean run into trials judged by an invariant. Drawn in SVG with the
 * docs theme's colours, so they follow light and dark mode.
 */
import type { ReactNode } from "react"

const BORDER = "var(--color-fd-border)"
const CARD = "var(--color-fd-card)"
const TEXT = "var(--color-fd-foreground)"
const MUTED = "var(--color-fd-muted-foreground)"
const LINE = "var(--color-fd-muted-foreground)"
const PASS = "var(--color-fd-success)"
const FAIL = "var(--color-fd-error)"

/** A labelled box, with an optional second line in a lighter colour. */
function Box(props: {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly label: string
  readonly note?: string
  readonly stroke?: string
}): ReactNode {
  const height = props.note === undefined ? 36 : 50

  return (
    <g>
      <rect
        x={props.x}
        y={props.y}
        width={props.width}
        height={height}
        rx={8}
        style={{ fill: CARD, stroke: props.stroke ?? BORDER, strokeWidth: 1.5 }}
      />
      <text
        x={props.x + props.width / 2}
        y={props.y + 23}
        textAnchor="middle"
        style={{ fill: TEXT, fontSize: 13, fontWeight: 600 }}
      >
        {props.label}
      </text>
      {props.note !== undefined && (
        <text
          x={props.x + props.width / 2}
          y={props.y + 39}
          textAnchor="middle"
          style={{ fill: MUTED, fontSize: 11 }}
        >
          {props.note}
        </text>
      )}
    </g>
  )
}

/** A line from one point to another, ending in an arrowhead. */
function Arrow(props: {
  readonly from: readonly [number, number]
  readonly to: readonly [number, number]
}): ReactNode {
  const [x1, y1] = props.from
  const [x2, y2] = props.to

  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      markerEnd="url(#danwo-arrow)"
      style={{ stroke: LINE, strokeWidth: 1.5 }}
    />
  )
}

/** The figure around a diagram: a scalable SVG with an arrowhead marker and a caption. */
function Figure(props: {
  readonly width: number
  readonly height: number
  readonly label: string
  readonly caption: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <figure className="danwo-diagram">
      <svg
        viewBox={`0 0 ${props.width} ${props.height}`}
        role="img"
        aria-label={props.label}
        style={{ width: "100%", height: "auto" }}
      >
        <defs>
          <marker
            id="danwo-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: LINE }} />
          </marker>
        </defs>
        {props.children}
      </svg>
      <figcaption>{props.caption}</figcaption>
    </figure>
  )
}

const PROVIDERS = ["Stripe", "Resend", "Slack", "…and more"]

/**
 * A test drives the browser, the browser talks to the app, and every call the app makes to a
 * third-party service goes through danwo's egress proxy to an emulator.
 */
export function HowItWorks(): ReactNode {
  return (
    <Figure
      width={760}
      height={250}
      label="Your test drives a browser; your app's calls to Stripe, Resend and other services go through danwo's proxy to emulators, and everything is recorded."
      caption="Your app keeps calling the real hostnames. The proxy answers them with emulators and records every call."
    >
      <Box x={10} y={95} width={120} label="Your test" note="*.danwo.ts" />
      <Arrow from={[130, 120]} to={[166, 120]} />
      <Box x={170} y={95} width={120} label="Browser" note="clicks, types" />
      <Arrow from={[290, 120]} to={[326, 120]} />
      <Box x={330} y={95} width={120} label="Your app" note="unchanged" />
      <Arrow from={[450, 120]} to={[486, 120]} />
      <Box x={490} y={95} width={110} label="danwo proxy" note="records calls" stroke={TEXT} />
      {PROVIDERS.map((name, i) => (
        <g key={name}>
          <Arrow from={[600, 120]} to={[646, 30 + i * 55]} />
          <Box x={650} y={12 + i * 55} width={100} label={name} />
        </g>
      ))}
      <text x={545} y={185} textAnchor="middle" style={{ fill: MUTED, fontSize: 11 }}>
        calls, webhooks and
      </text>
      <text x={545} y={200} textAnchor="middle" style={{ fill: MUTED, fontSize: 11 }}>
        database statements
      </text>
      <text x={545} y={215} textAnchor="middle" style={{ fill: MUTED, fontSize: 11 }}>
        go in the flight record
      </text>
    </Figure>
  )
}

const TRIALS: readonly { readonly fault: string; readonly verdict: "PASS" | "FAIL" }[] = [
  { fault: "Stripe answers 500", verdict: "PASS" },
  { fault: "webhook arrives twice", verdict: "FAIL" },
  { fault: "Pay is clicked twice", verdict: "PASS" },
  { fault: "COMMIT reply is lost", verdict: "PASS" },
]

/** One clean run becomes a trial per planned fault, and the invariant judges each trial. */
export function MatrixFlow(): ReactNode {
  return (
    <Figure
      width={760}
      height={260}
      label="danwo runs the test once cleanly, plans one trial per fault, replays the test under each fault, and checks the invariant after each trial."
      caption="One clean run, one trial per fault, the same invariant after every trial."
    >
      <Box x={10} y={100} width={140} label="Clean run" note="records every call" />
      {TRIALS.map((trial, i) => {
        const y = 15 + i * 60
        const colour = trial.verdict === "PASS" ? PASS : FAIL

        return (
          <g key={trial.fault}>
            <Arrow from={[150, 125]} to={[226, y + 18]} />
            <Box x={230} y={y} width={200} label={trial.fault} />
            <Arrow from={[430, y + 18]} to={[476, y + 18]} />
            <Box x={480} y={y} width={130} label="invariant" />
            <Arrow from={[610, y + 18]} to={[656, y + 18]} />
            <Box x={660} y={y} width={90} label={trial.verdict} stroke={colour} />
          </g>
        )
      })}
    </Figure>
  )
}
