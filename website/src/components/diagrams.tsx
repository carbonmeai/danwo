/**
 * Diagrams the docs pages draw inline: how a test's requests reach danwo's emulators, and how a
 * fault matrix turns one clean run into trials judged by an invariant. Drawn in SVG with the
 * docs theme's colours, so they follow light and dark mode.
 */
import type { ReactNode } from "react"

export const TEXT = "var(--color-fd-foreground)"
export const MUTED = "var(--color-fd-muted-foreground)"

const BORDER = "var(--color-fd-border)"
const CARD = "var(--color-fd-card)"
const LINE = "var(--color-fd-muted-foreground)"
const PASS = "var(--color-fd-success)"
const FAIL = "var(--color-fd-error)"

/** A labelled box, with an optional second line in a lighter colour. */
export function Box(props: {
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
export function Arrow(props: {
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

/** An arrow that turns corners: a line through `points`, with the arrowhead at the last one. */
function ElbowArrow(props: {
  readonly points: readonly (readonly [number, number])[]
}): ReactNode {
  return (
    <polyline
      points={props.points.map(([x, y]) => `${x},${y}`).join(" ")}
      markerEnd="url(#danwo-arrow)"
      style={{ fill: "none", stroke: LINE, strokeWidth: 1.5, strokeLinejoin: "round" }}
    />
  )
}

/** The figure around a diagram: a scalable SVG with an arrowhead marker and a caption. */
export function Figure(props: {
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

/** A short label under a box, in the lighter colour. */
function Note(props: { readonly x: number; readonly y: number; readonly text: string }): ReactNode {
  return (
    <text x={props.x} y={props.y} textAnchor="middle" style={{ fill: MUTED, fontSize: 11 }}>
      {props.text}
    </text>
  )
}

/**
 * An agent step's first run asks the model and keeps what it did; later runs replay that
 * recording with no model, and hand the step back to the model only when the page changed.
 */
export function ReplayFlow(): ReactNode {
  return (
    <Figure
      width={760}
      height={210}
      label="The first run asks the model and records the step. Later runs replay the recording with no model call, unless the page changed, when the model takes the step over and records it afresh."
      caption="The model runs once per step. After that, the recording replays it."
    >
      <Box x={10} y={20} width={150} label="First run" note="no recording yet" />
      <Arrow from={[160, 45]} to={[216, 45]} />
      <Box x={220} y={20} width={150} label="Model acts" note="and is checked" />
      <Arrow from={[370, 45]} to={[426, 45]} />
      <Box x={430} y={20} width={150} label="Recording kept" note="in cache.dir" stroke={TEXT} />
      <Box x={10} y={130} width={150} label="Next run" note="recording found" />
      <Arrow from={[160, 155]} to={[216, 155]} />
      <Box x={220} y={130} width={150} label="Replayed" note="0 model calls" stroke={PASS} />
      <Arrow from={[370, 155]} to={[596, 155]} />
      <Box x={600} y={130} width={150} label="Page changed?" note="model takes over" />
      <Arrow from={[675, 130]} to={[580, 70]} />
      <Note x={505} y={115} text="records it afresh" />
    </Figure>
  )
}

/**
 * The app calls a provider's real hostname; danwo's proxy answers it from that provider's
 * emulator, seeded by the config, and the test reads the emulator's state through a fixture.
 */
export function EmulatorFlow(): ReactNode {
  return (
    <Figure
      width={760}
      height={230}
      label="Your app calls api.stripe.com as usual. danwo's proxy sends the call to the Stripe emulator, which the config seeded. The test reads what the emulator holds through the stripe fixture."
      caption="The app never knows. The test can ask the emulator what the app did."
    >
      <Box x={10} y={30} width={130} label="Your app" note="calls api.stripe.com" />
      <Arrow from={[140, 55]} to={[226, 55]} />
      <Box x={230} y={30} width={130} label="danwo proxy" note="records the call" stroke={TEXT} />
      <Arrow from={[360, 55]} to={[446, 55]} />
      <Box x={450} y={30} width={150} label="Stripe emulator" note="customers, sessions…" />
      <Box x={450} y={150} width={150} label="seed" note="from danwo.config.ts" />
      <Arrow from={[525, 150]} to={[525, 82]} />
      <Box x={640} y={30} width={110} label="Your test" note="stripe fixture" />
      <Arrow from={[640, 55]} to={[604, 55]} />
      <Note x={295} y={110} text="webhooks go back" />
      <Note x={295} y={125} text="to your app, signed" />
    </Figure>
  )
}

const SLOTS: readonly { readonly label: string; readonly note: string; readonly used: string }[] = [
  { label: "pristine", note: "seeded state", used: "tests with no session" },
  { label: "pristine + ada", note: "Ada signed in", used: "tests using ada" },
  { label: "pristine + bob", note: "Bob signed in", used: "tests using bob" },
]

/** A worker keeps a clean snapshot and one per saved session, and restores the right one. */
export function IsolationSlots(): ReactNode {
  return (
    <Figure
      width={760}
      height={220}
      label="After the environment starts, the worker keeps a pristine snapshot. Each saved session gets a snapshot of its own on top of it. Before every test the worker restores the snapshot that test needs."
      caption="Each test starts from the snapshot it needs, never from the last test's leftovers."
    >
      <Box x={10} y={85} width={140} label="Environment" note="started and seeded" />
      {SLOTS.map((slot, i) => {
        const y = 15 + i * 70

        return (
          <g key={slot.label}>
            <Arrow from={[150, 110]} to={[246, y + 25]} />
            <Box x={250} y={y} width={170} label={slot.label} note={slot.note} stroke={TEXT} />
            <Arrow from={[420, y + 25]} to={[496, y + 25]} />
            <Box x={500} y={y} width={250} label={slot.used} />
          </g>
        )
      })}
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

/**
 * Where an AWS SDK call goes: S3 to danwo's S3 emulator, the Bedrock runtime to the model API
 * emulator, every other AWS host to MiniStack.
 */
export function AwsRouting(): ReactNode {
  return (
    <Figure
      width={760}
      height={250}
      label="Your app's AWS SDK calls amazonaws.com; danwo's proxy sends S3 calls to danwo's S3 emulator, Bedrock runtime calls to danwo's model API emulator, and every other AWS call to MiniStack."
      caption="The most specific host wins, so S3 and Bedrock stay with danwo whatever order the services are listed in."
    >
      <Box x={10} y={100} width={170} label="Your app" note="AWS SDK, real hosts" />
      <Arrow from={[180, 125]} to={[246, 125]} />
      <Box
        x={250}
        y={100}
        width={150}
        label="danwo proxy"
        note="routes by hostname"
        stroke={TEXT}
      />
      <Arrow from={[400, 115]} to={[486, 50]} />
      <Arrow from={[400, 125]} to={[486, 125]} />
      <Arrow from={[400, 135]} to={[486, 200]} />
      <Box
        x={490}
        y={25}
        width={260}
        label="danwo's S3 emulator"
        note="s3.amazonaws.com, if s3Service runs"
      />
      <Box
        x={490}
        y={100}
        width={260}
        label="danwo's model API emulator"
        note="bedrock-runtime.*, if llmService runs"
      />
      <Box x={490} y={175} width={260} label="MiniStack" note="every other *.amazonaws.com" />
    </Figure>
  )
}

/**
 * One provider call: the app's own SDK calls the real hostname, the proxy sends it to the
 * emulator, the emulator keeps the state a test reads, and its webhook comes back to the app.
 */
export function ProviderFlow(): ReactNode {
  return (
    <Figure
      width={760}
      height={230}
      label="Your app's SDK calls api.stripe.com; danwo's proxy routes the call to the Stripe emulator, which keeps the state your test reads and sends its signed webhook back to your app."
      caption="The app's code and keys stay as they are. The emulator answers, remembers and sends webhooks back."
    >
      <Box x={10} y={40} width={170} label="Your app" note="stripe.checkout…create()" />
      <Arrow from={[180, 65]} to={[256, 65]} />
      <text x={218} y={55} textAnchor="middle" style={{ fill: MUTED, fontSize: 11 }}>
        api.stripe.com
      </text>
      <Box x={260} y={40} width={150} label="danwo proxy" note="routes by hostname" stroke={TEXT} />
      <Arrow from={[410, 65]} to={[486, 65]} />
      <Box x={490} y={40} width={170} label="Stripe emulator" note="customers, sessions…" />
      <Arrow from={[575, 90]} to={[575, 146]} />
      <Box x={490} y={150} width={170} label="Your test" note="reads its state" />
      <ElbowArrow
        points={[
          [520, 90],
          [520, 122],
          [95, 122],
          [95, 94],
        ]}
      />
      <text x={307} y={140} textAnchor="middle" style={{ fill: MUTED, fontSize: 11 }}>
        signed webhook back to your app
      </text>
    </Figure>
  )
}
