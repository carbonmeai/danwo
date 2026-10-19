/** How it works, in three figures: write the test, emulate and record, break it. */
import { useCallback, useRef, useState } from "react"

import { useInView, useReducedMotion, useTicker } from "./motion.ts"
import { Reveal } from "./reveal.tsx"

/** Fig 0.1: the test, with the agent's step picked out. */
function WriteFigure() {
  return (
    <div className="vis">
      <div className="mini-code">
        <span className="f">test</span>(<span className="s">"buys 500 credits"</span>,{" "}
        <span className="k">async</span> () =&gt; {"{"}
        {"\n  "}
        <span className="k">await</span> app.<span className="f">open</span>(
        <span className="s">"/"</span>){"\n  "}
        <span className="hl">
          <span className="k">await</span> agent.<span className="f">act</span>(
          <span className="s">"buy 500 credits"</span>)
        </span>
        {"\n  "}
        <span className="k">await</span> <span className="f">expect</span>(credits).
        <span className="f">toHaveText</span>(<span className="s">"500"</span>){"\n"}
        {"})."}
        <span className="f">invariant</span>(<span className="c">/* paid = granted */</span>)
        <span className="caret" />
      </div>
    </div>
  )
}

/** The providers the proxy fans out to, by their row in the figure. */
const FAN = [
  { y: 36, path: "M202 116 C 240 116, 248 36, 290 36", icon: "stripe.svg" },
  {
    y: 76,
    path: "M202 116 C 240 116, 250 76, 290 76",
    icon: "resend.svg",
    dark: "resend-on-dark.svg",
  },
  { y: 116, path: "M202 116 L290 116", icon: "slack.svg" },
  {
    y: 156,
    path: "M202 116 C 240 116, 250 156, 290 156",
    icon: "openai.svg",
    dark: "openai-on-dark.svg",
  },
  { y: 196, path: "M202 116 C 240 116, 248 196, 290 196", icon: "postgresql.svg" },
]

const APP_PATH = "M76 116 L158 116"

/** A dot travelling a path: out to a provider, or back as a webhook. */
function Dot({
  path,
  begin,
  back,
}: {
  readonly path: string
  readonly begin: number
  readonly back?: boolean
}) {
  return (
    <circle r="2.6" className={back ? "ret" : "req"} opacity="0">
      <animateMotion
        dur="2.4s"
        begin={`${begin}s`}
        repeatCount="indefinite"
        calcMode="linear"
        path={path}
        {...(back && { keyPoints: "1;0", keyTimes: "0;1" })}
      />
      <animate
        attributeName="opacity"
        values="0;1;1;0"
        keyTimes="0;.12;.85;1"
        dur="2.4s"
        begin={`${begin}s`}
        repeatCount="indefinite"
      />
    </circle>
  )
}

/** Fig 0.2: the app's calls go through the proxy to the emulators. */
function FlowFigure() {
  const reduce = useReducedMotion()

  return (
    <div className="vis">
      <svg
        className="flow"
        viewBox="0 0 360 232"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Your app's calls pass through danwo's egress proxy to emulated Stripe, Resend, Slack, OpenAI and Postgres"
      >
        <path d={APP_PATH} className="path" />
        {FAN.map((provider) => (
          <path key={provider.y} d={provider.path} className="path" />
        ))}
        <g transform="translate(26 96)">
          <rect className="node-bg" x="-6" y="-6" width="52" height="52" rx="14" />
          <rect className="app-ink" x="6" y="9" width="28" height="22" rx="4" />
          <path className="app-ink" d="M6 15 H34" />
          <circle className="app-dot" cx="10" cy="12" r="1.1" />
          <circle className="app-dot" cx="13.5" cy="12" r="1.1" />
        </g>
        <text className="lbl" x="46" y="168" textAnchor="middle">
          your app
        </text>
        <text className="lbl-2" x="46" y="182" textAnchor="middle">
          unchanged
        </text>
        <circle className="hub-ring" cx="180" cy="116" r="31">
          {!reduce && (
            <>
              <animate attributeName="r" values="26;34;26" dur="3s" repeatCount="indefinite" />
              <animate
                attributeName="stroke-opacity"
                values=".45;0;.45"
                dur="3s"
                repeatCount="indefinite"
              />
            </>
          )}
        </circle>
        <circle className="hub" cx="180" cy="116" r="23" />
        <g transform="translate(171 107)">
          <rect className="hub-ink-o" x="1.5" y="1.5" width="9" height="9" rx="2.2" />
          <rect className="hub-ink" x="7" y="7" width="9" height="9" rx="2" />
        </g>
        <text className="lbl" x="180" y="168" textAnchor="middle">
          egress proxy
        </text>
        <text className="lbl-2" x="180" y="182" textAnchor="middle">
          records every call
        </text>
        {FAN.map((provider) => (
          <g key={provider.y}>
            <circle className="node-bg" cx="308" cy={provider.y} r="17" />
            <image
              href={`/icons/${provider.icon}`}
              x="299"
              y={provider.y - 9}
              width="18"
              height="18"
              {...(provider.dark && { className: "only-light" })}
            />
            {provider.dark && (
              <image
                href={`/icons/${provider.dark}`}
                x="299"
                y={provider.y - 9}
                width="18"
                height="18"
                className="only-dark"
              />
            )}
          </g>
        ))}
        {!reduce && (
          <g>
            <Dot path={APP_PATH} begin={0} />
            <Dot path={APP_PATH} begin={1.2} />
            {FAN.map((provider, i) => (
              <Dot
                key={provider.y}
                path={provider.path}
                begin={[0.5, 1.1, 1.7, 0.9, 1.4][i] ?? 0}
              />
            ))}
            <Dot path={FAN[0]?.path ?? APP_PATH} begin={1.9} back />
            <Dot path={APP_PATH} begin={2.1} back />
          </g>
        )}
      </svg>
    </div>
  )
}

/** Which of the 40 trials held, broke or did not apply. */
const MINI = Array.from({ length: 40 }, (_, i) => {
  if (i === 5 || i === 22) return "x"

  return [3, 12, 17, 30, 35, 38].includes(i) ? "" : "p"
})

/** Fig 0.3: a small matrix that fills trial by trial. */
function BreakFigure() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const visible = useInView(ref, 0.3)
  const [tick, setTick] = useState(0)
  const step = useCallback(() => setTick((value) => (value + 1) % 78), [])

  useTicker(visible && !reduce, 70, step)

  const shown = reduce ? MINI.length : Math.min(tick, MINI.length)

  return (
    <div className="vis">
      <div className="mini-wrap">
        <div className="mini-mx" ref={ref}>
          {MINI.map((kind, i) => (
            <i key={i} className={i < shown ? kind : ""} />
          ))}
        </div>
        <div className="mini-cap">
          <span>40 trials</span>
          <span style={{ color: "var(--red-text)" }}>2 broke</span>
        </div>
      </div>
    </div>
  )
}

export function HowItWorks() {
  return (
    <section className="how" id="how">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow">
            <i />
            How it works
          </span>
        </Reveal>
        <Reveal as="h2">One test. Every way it can go wrong.</Reveal>
        <Reveal as="p" className="lede">
          You write the happy path once. danwo records what it caused behind the app, then replays
          it under every fault your providers, network and database can throw.
        </Reveal>
        <div className="steps">
          <Reveal className="step">
            <span className="fig">Fig 0.1 · write</span>
            <WriteFigure />
            <h3>Write the test</h3>
            <p>
              Steps with locators, or plain English for the agent, plus an invariant: a rule that
              must hold whatever happened. <code>danwo record</code> can draft both.
            </p>
          </Reveal>
          <Reveal className="step">
            <span className="fig">Fig 0.2 · emulate and record</span>
            <FlowFigure />
            <h3>danwo emulates and records</h3>
            <p>
              An egress proxy answers real provider hostnames from emulators. Every call, webhook
              and statement is logged, and the agent's choices are cached for replay.
            </p>
          </Reveal>
          <Reveal className="step">
            <span className="fig">Fig 0.3 · break</span>
            <BreakFigure />
            <h3>The matrix breaks it</h3>
            <p>
              It replays the clean run once per planned fault: declines, 500s, timeouts, duplicate
              or forged webhooks, double-submits, Postgres and Redis faults, time travel.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
