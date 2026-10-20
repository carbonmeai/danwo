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

/** A dashed region labelled with what it holds, drawn behind boxes. */
function Region(props: {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly label: string
  readonly strong?: boolean
}): ReactNode {
  return (
    <g>
      <rect
        x={props.x}
        y={props.y}
        width={props.width}
        height={props.height}
        rx={12}
        style={{
          fill: "none",
          stroke: props.strong === true ? TEXT : BORDER,
          strokeWidth: 1.5,
          strokeDasharray: "6 5",
        }}
      />
      <text x={props.x + 14} y={props.y + 20} style={{ fill: MUTED, fontSize: 11 }}>
        {props.label}
      </text>
    </g>
  )
}

/**
 * The one rule: what runs inside danwo's proxy can be emulated and faulted; what runs elsewhere
 * reaches the real services, unseen.
 */
export function ProxyBoundary(): ReactNode {
  return (
    <Figure
      width={760}
      height={270}
      label="Inside danwo's proxy: the browser or device danwo drives, the apps danwo starts, the emulators and the data proxies. Outside: servers danwo did not start, and the real providers they call."
      caption="Everything inside the dashed line goes through danwo's proxy. Outside it, danwo sees nothing."
    >
      <Region x={10} y={10} width={470} height={250} label="inside danwo's proxy" strong />
      <Box x={30} y={45} width={130} label="Browser or device" note="danwo drives it" />
      <Box x={30} y={135} width={130} label="Apps danwo starts" note="your dev servers" />
      <Box x={190} y={90} width={110} label="danwo proxy" note="records, faults" stroke={TEXT} />
      <Box x={330} y={45} width={130} label="Emulators" note="Stripe, Clerk, …" />
      <Box x={330} y={135} width={130} label="Data proxies" note="Postgres, Redis" />
      <Arrow from={[160, 70]} to={[186, 105]} />
      <Arrow from={[160, 160]} to={[186, 125]} />
      <Arrow from={[300, 105]} to={[326, 70]} />
      <Arrow from={[300, 125]} to={[326, 160]} />
      <Region x={510} y={10} width={240} height={250} label="outside: danwo sees nothing" />
      <Box
        x={530}
        y={70}
        width={200}
        label="Servers danwo didn't start"
        note="staging, a remote API"
      />
      <Box x={530} y={160} width={200} label="Real providers" note="what those servers call" />
      <Arrow from={[630, 120]} to={[630, 156]} />
    </Figure>
  )
}

/** One place a test's requests go, and whether it sits inside danwo's proxy. */
interface Hop {
  readonly label: string
  readonly note: string
  readonly inside: boolean
}

/** The request path of each setup on the "Where danwo runs" pages. */
const SETUPS = {
  "full-stack": [
    { label: "Browser", note: "danwo drives it", inside: true },
    { label: "Your app", note: "pages, API, actions", inside: true },
    { label: "Emulators", note: "Stripe, Resend, …", inside: true },
  ],
  split: [
    { label: "Browser", note: "danwo drives it", inside: true },
    { label: "Frontend", note: "danwo starts it", inside: true },
    { label: "API", note: "danwo starts it", inside: true },
    { label: "Emulators", note: "Stripe, Clerk, …", inside: true },
  ],
  "frontend-only": [
    { label: "Browser", note: "danwo drives it", inside: true },
    { label: "Frontend", note: "danwo starts it", inside: true },
    { label: "Remote API", note: "already running", inside: false },
    { label: "Real providers", note: "what it calls", inside: false },
  ],
  staging: [
    { label: "Browser", note: "danwo drives it", inside: true },
    { label: "Staging site", note: "deployed", inside: false },
    { label: "Sandboxes", note: "real test accounts", inside: false },
  ],
  production: [
    { label: "Browser", note: "danwo drives it", inside: false },
    { label: "Production", note: "live site", inside: false },
    { label: "Real providers", note: "live accounts", inside: false },
  ],
} satisfies Readonly<Record<string, readonly Hop[]>>

const HOP_WIDTH = 150
const HOP_GAP = 40

/** A scenario's request path, left to right, with danwo's proxy drawn around the hops it covers. */
export function Setup(props: { readonly kind: keyof typeof SETUPS }): ReactNode {
  const hops: readonly Hop[] = SETUPS[props.kind]
  const inside = hops.filter((hop) => hop.inside).length

  return (
    <Figure
      width={760}
      height={150}
      label={hops
        .map((hop) => `${hop.label}, ${hop.inside ? "inside" : "outside"} danwo's proxy`)
        .join("; then ")}
      caption={
        inside === 0
          ? "No proxy: danwo drives and records the browser, and nothing else."
          : "The dashed line is danwo's proxy: what's inside can be emulated and faulted."
      }
    >
      {inside > 0 && (
        <Region
          x={4}
          y={8}
          width={inside * (HOP_WIDTH + HOP_GAP) - HOP_GAP / 2 + 6}
          height={134}
          label="inside danwo's proxy"
          strong
        />
      )}
      {hops.map((hop, i) => {
        const x = 10 + i * (HOP_WIDTH + HOP_GAP)

        return (
          <g key={hop.label}>
            {i > 0 && <Arrow from={[x - HOP_GAP, 87]} to={[x - 4, 87]} />}
            <Box x={x} y={62} width={HOP_WIDTH} label={hop.label} note={hop.note} />
          </g>
        )
      })}
    </Figure>
  )
}
