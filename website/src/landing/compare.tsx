/** The comparison with testing that stops at the screen. */

import { Mark } from "../components/brand.tsx"
import { PROVIDERS } from "../lib/providers.ts"
import { licenceWords } from "../lib/site.ts"
import { CheckIcon, CrossIcon, DashIcon } from "./glyphs.tsx"
import { Reveal } from "./reveal.tsx"

/** How a column answers a row: yes, partly or no, and in what words. */
type Answer = readonly ["yes" | "part" | "no", string]

const ROWS: readonly (readonly [what: string, detail: string, danwo: Answer, others: Answer])[] = [
  [
    "Drives the UI with an agent",
    "plain-English steps on web and mobile",
    ["yes", "Yes"],
    ["yes", "Yes"],
  ],
  [
    "Replays with no model calls",
    "cached choices, deterministic reruns",
    ["yes", "Always"],
    ["part", "Sometimes"],
  ],
  [
    "Emulated third-party providers",
    "Stripe, Resend, Slack, model APIs and more",
    ["yes", `${PROVIDERS.length} providers`],
    ["no", "Real sandboxes"],
  ],
  [
    "Judges what happened behind the app",
    "invariants over calls, webhooks and data",
    ["yes", "Yes"],
    ["no", "Pixels only"],
  ],
  [
    "Fault matrix",
    "declines, 500s, timeouts, webhook faults",
    ["yes", "Planned per run"],
    ["no", "No"],
  ],
  [
    "Races and data faults",
    "double-submit, Postgres and Redis, time travel",
    ["yes", "Yes"],
    ["no", "No"],
  ],
  [
    "Flight record of the backend",
    "waterfall, effects diff, emulator state",
    ["yes", "Yes"],
    ["part", "Video and DOM"],
  ],
  ["Runs on your own machines", "your CI, your data", ["yes", licenceWords()], ["no", "Rarely"]],
]

function AnswerCell({ answer: [kind, words] }: { readonly answer: Answer }) {
  const icon = kind === "yes" ? <CheckIcon /> : kind === "part" ? <DashIcon /> : <CrossIcon />

  return (
    <div role="cell">
      <span className={kind}>
        {icon}
        <span>{words}</span>
      </span>
    </div>
  )
}

export function Compare() {
  return (
    <section className="cmp tinted" id="compare">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow" style={{ "--dot": "var(--red)" }}>
            <i />
            Compare
          </span>
        </Reveal>
        <Reveal as="h2">The screen is the easy part.</Reveal>
        <Reveal as="p" className="lede">
          UI-only AI testing tells you the button worked. danwo tells you what the button did.
        </Reveal>
        <Reveal className="cmp-table">
          <div role="table" aria-label="danwo compared with UI-only AI testing">
            <div className="trow thead" role="row">
              <div role="columnheader" />
              <div className="us" role="columnheader">
                <Mark size={18} />
                danwo
              </div>
              <div role="columnheader">UI-only AI testing</div>
            </div>
            {ROWS.map(([what, detail, danwo, others]) => (
              <div key={what} className="trow" role="row">
                <div className="what" role="cell">
                  {what}
                  <small>{detail}</small>
                </div>
                <AnswerCell answer={danwo} />
                <AnswerCell answer={others} />
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
