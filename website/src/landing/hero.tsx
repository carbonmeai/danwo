import { Link } from "@tanstack/react-router"
import { forwardRef, useEffect, useRef, useState } from "react"

import { repoUrl, SITE } from "../lib/site.ts"
import { CopyBox } from "./copy.tsx"
import { ChevronIcon, GithubIcon } from "./glyphs.tsx"
import { HeroMatrix } from "./matrix.tsx"

/** One lane of the waterfall: its label, its bars (left and width in %) and its duration. */
interface Lane {
  readonly label: string
  readonly icon?: string
  readonly sub?: boolean
  readonly bars: readonly (readonly [kind: string, left: number, width: number])[]
  readonly ms: string
  readonly duplicate?: number
}

const LANES: readonly Lane[] = [
  { label: "step /", bars: [["st", 0, 14]], ms: "168ms" },
  { label: "click Buy", bars: [["st", 15, 9]], ms: "104ms" },
  { label: "POST checkout", icon: "stripe.svg", sub: true, bars: [["pc", 17, 12]], ms: "142ms" },
  { label: "INSERT orders", icon: "postgresql.svg", sub: true, bars: [["db", 30, 4]], ms: "9ms" },
  { label: "click Pay", bars: [["st", 36, 22]], ms: "262ms" },
  { label: "GET checkout", icon: "stripe.svg", sub: true, bars: [["pc", 38, 10]], ms: "118ms" },
  { label: "webhook", icon: "stripe.svg", sub: true, bars: [["wh", 52, 8]], ms: "96ms" },
  {
    label: "webhook (dup)",
    icon: "stripe.svg",
    sub: true,
    bars: [["ft", 62, 8]],
    ms: "dup",
    duplicate: 61.5,
  },
  {
    label: "UPDATE credits",
    icon: "postgresql.svg",
    sub: true,
    bars: [
      ["db", 56, 3],
      ["db", 71, 3],
    ],
    ms: "×2",
  },
  { label: "expect Credits", bars: [["ft", 76, 22]], ms: "1.0s" },
]

/** Each lane's first bar's place among all bars, so the bars grow in one after another. */
const FIRST_BAR = LANES.map((_lane, i) =>
  LANES.slice(0, i).reduce((count, lane) => count + lane.bars.length, 0),
)

/** The flight record pane: a waterfall with a playhead sweeping across it. */
function Waterfall() {
  const ref = useRef<HTMLDivElement>(null)
  const [sweep, setSweep] = useState(260)

  useEffect(() => {
    const lane = ref.current?.querySelector<HTMLElement>(".wf .tr")

    if (!lane) return undefined

    const measure = () => setSweep(lane.offsetWidth)
    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(lane)

    return () => observer.disconnect()
  }, [])

  return (
    <div className="wf-wrap" ref={ref} style={{ "--sweep": `${sweep}px` }}>
      <div className="wf-axis">
        <span />
        <div>
          <span>0</span>
          <span>0.4s</span>
          <span>0.8s</span>
          <span>1.2s</span>
        </div>
        <span />
      </div>
      <div className="wf">
        {LANES.map((lane, i) => (
          <WaterfallLane key={lane.label} lane={lane} first={FIRST_BAR[i] ?? 0} />
        ))}
      </div>
      <i className="playhead" />
    </div>
  )
}

function WaterfallLane({ lane, first }: { readonly lane: Lane; readonly first: number }) {
  return (
    <>
      <span className={lane.sub ? "lb sub" : "lb"}>
        {lane.icon && <img src={`/icons/${lane.icon}`} alt="" />}
        {lane.label}
      </span>
      <span className="tr">
        {lane.bars.map(([kind, left, width], i) => (
          <i
            key={`${kind}${left}`}
            className={`bar ${kind}`}
            style={{ left: `${left}%`, width: `${width}%`, "--i": first + i }}
          />
        ))}
        {lane.duplicate !== undefined && (
          <i className="dup" style={{ left: `${lane.duplicate}%` }} />
        )}
      </span>
      <span className="ms" style={lane.duplicate === undefined ? undefined : { color: "#ff7479" }}>
        {lane.ms}
      </span>
    </>
  )
}

/** The dark hero: headline, the install command and a product shot drawn in HTML. */
export const Hero = forwardRef<HTMLElement>(function Hero(_props, ref) {
  const github = repoUrl()

  return (
    <section className="hero" id="hero" ref={ref}>
      <div className="wrap">
        <Link className="pill" to="/docs/$" params={{ _splat: "mobile" }}>
          <b>New</b>Android and iOS apps: same tests, same matrix
          <span className="more">
            <ChevronIcon size={12} />
          </span>
        </Link>
        <h1>
          Drive the UI. <span className="dim">Judge everything behind it.</span>
        </h1>
        <div className="hero-row">
          <p className="hero-sub">
            danwo is {SITE.licence.openSource ? "the open-source" : "the"} testing platform for the
            agentic era. It clicks through your web and mobile app like a user,{" "}
            <strong>
              while emulated Stripe, Clerk, Resend and twenty more providers record every call
            </strong>
            , then breaks the run on purpose, once per fault you should survive.
          </p>
          <div className="hero-meta">
            <span>no app code changes</span>
            <span>0 model calls on replay</span>
          </div>
        </div>
        <div className="ctas">
          <CopyBox command="npx @danwo/cli init" />
          {github ? (
            <a className="btn btn-solid" href={github}>
              <GithubIcon />
              GitHub
            </a>
          ) : (
            <Link className="btn btn-solid" to="/docs/$" params={{ _splat: "quickstart" }}>
              Quickstart
            </Link>
          )}
          <Link className="btn btn-soft" to="/docs/$" params={{ _splat: "" }}>
            Read the docs <ChevronIcon />
          </Link>
        </div>
        <div
          className="shot"
          aria-label="A fault matrix and a flight-record waterfall from a danwo run"
        >
          <div className="frame">
            <div className="chrome">
              <div className="dots">
                <i />
                <i />
                <i />
              </div>
              <div className="crumb">
                tests/buy-credits.danwo.ts<em>›</em>buys 500 credits through Stripe Checkout
              </div>
              <div className="cmd">$ danwo matrix</div>
            </div>
            <div className="shot-body">
              <div className="pane">
                <HeroMatrix />
              </div>
              <div className="pane">
                <div className="pane-h">
                  <h3>
                    Flight record <span>· duplicate webhook</span>
                  </h3>
                  <span className="badge b-fail">failed</span>
                </div>
                <Waterfall />
                <div className="inv">
                  invariant: expected <b>1000</b> to be <b>500</b>
                  <br />
                  <span className="dim">granted credits ≠ credits Stripe was paid for</span>
                </div>
                <div className="effects">
                  <span>stripe.checkout_sessions</span>
                  <span className="p">+1</span>
                  <span>paid 500</span>
                  <span>ledger.credits</span>
                  <span className="m">+1000</span>
                  <span>granted 2×</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
})
