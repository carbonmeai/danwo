/** The product section: what danwo checks behind the screen, one tile per part. */
import type { ReactNode } from "react"

import { PROVIDERS } from "../lib/providers.ts"
import { CheckIcon, CrossIcon } from "./glyphs.tsx"
import { Logo, type LogoFiles } from "./logo.tsx"
import { Reveal } from "./reveal.tsx"

/** The emulator tile's chips: Google's products and the model providers get one each. */
const CHIPS: readonly (LogoFiles & { readonly name: string; readonly wordmark?: boolean })[] = [
  { name: "Stripe", src: "stripe.svg" },
  { name: "Resend", src: "resend.svg", dark: "resend-on-dark.svg" },
  { name: "Amazon S3", src: "s3.svg" },
  {
    name: "Tigris",
    src: "wordmarks/tigris.svg",
    dark: "wordmarks/tigris-on-dark.svg",
    wordmark: true,
  },
  { name: "Google sign-in", src: "google.svg" },
  { name: "Gmail", src: "gmail.svg" },
  { name: "Calendar", src: "google-calendar.svg" },
  { name: "Drive", src: "google-drive.svg" },
  { name: "Microsoft", src: "microsoft.svg" },
  { name: "Slack", src: "slack.svg" },
  { name: "GitHub", src: "github.svg", dark: "github-on-dark.svg" },
  { name: "Twilio", src: "twilio.svg" },
  { name: "Paystack", src: "paystack.svg" },
  { name: "Flutterwave", src: "flutterwave.svg" },
  { name: "Bachs", src: "bachs.png" },
  { name: "Auth0", src: "auth0.svg" },
  { name: "Clerk", src: "clerk.svg", dark: "clerk-on-dark.svg" },
  { name: "Nylas", src: "nylas.png" },
  { name: "Nango", src: "nango.png", dark: "nango-on-dark.png" },
  { name: "Unipile", src: "unipile.png" },
  { name: "Pusher", src: "pusher.svg", dark: "pusher-on-dark.svg" },
  { name: "Novu", src: "novu.svg", dark: "novu-on-dark.svg" },
  { name: "Tiptap", src: "tiptap.png", dark: "tiptap-on-dark.png" },
  { name: "Composio", src: "composio.svg", dark: "composio-on-dark.svg" },
  { name: "OpenAI", src: "openai.svg", dark: "openai-on-dark.svg" },
  { name: "Anthropic", src: "anthropic.svg", dark: "anthropic-on-dark.svg" },
  { name: "Gemini", src: "gemini.svg" },
  { name: "Perplexity", src: "perplexity.svg" },
  { name: "Bedrock", src: "bedrock.svg" },
]

/** Calls scrolling under the chips: status, path, time or fault. */
const TICKS: readonly (LogoFiles & {
  readonly code: string
  readonly tone: string
  readonly path: string
  readonly ms: string
})[] = [
  { src: "stripe.svg", code: "200", tone: "ok", path: "POST /v1/checkout/sessions", ms: "142ms" },
  {
    src: "resend.svg",
    dark: "resend-on-dark.svg",
    code: "202",
    tone: "ok",
    path: "POST /emails",
    ms: "31ms",
  },
  { src: "s3.svg", code: "500", tone: "er", path: "PUT /receipts/r_81.pdf", ms: "fault" },
  { src: "slack.svg", code: "200", tone: "ok", path: "POST /api/chat.postMessage", ms: "22ms" },
  {
    src: "openai.svg",
    dark: "openai-on-dark.svg",
    code: "429",
    tone: "wn",
    path: "POST /v1/responses",
    ms: "fault",
  },
  {
    src: "gmail.svg",
    code: "200",
    tone: "ok",
    path: "GET /gmail/v1/users/me/messages",
    ms: "18ms",
  },
  {
    src: "github.svg",
    dark: "github-on-dark.svg",
    code: "201",
    tone: "ok",
    path: "POST /repos/o/r/issues",
    ms: "40ms",
  },
  {
    src: "paystack.svg",
    code: "200",
    tone: "ok",
    path: "GET /transaction/verify/ref_9",
    ms: "27ms",
  },
]

/** The faults one checkout run planned, with how each trial went. */
const FAULTS: readonly (readonly [fault: string, broke?: boolean])[] = [
  ["decline · card_declined"],
  ["status 500 · checkout"],
  ["timeout · resend"],
  ["reset · checkout.stripe.com"],
  ["duplicate · webhook", true],
  ["forged · webhook"],
  ["double-submit · POST /buy"],
  ["pg · COMMIT fails"],
  ["time · +30 days"],
]

function EmulatorsTile() {
  return (
    <Reveal as="article" className="tile c4 wide">
      <h3>Provider emulators</h3>
      <p>
        Stateful stand-ins for the {PROVIDERS.length} providers your app pays for, with real
        hostnames, signed webhooks, sockets and the error shapes your code has to handle, for your
        frontend, API and workers together behind one proxy. No sandbox keys, no rate limits, no
        flakes.
      </p>
      <div className="art">
        <div className="emu-grid">
          {CHIPS.map((chip) => (
            <span key={chip.name} className="emu" title={chip.name}>
              <Logo
                files={chip}
                alt={chip.wordmark ? chip.name : ""}
                {...(chip.wordmark && { className: "wordmark" })}
              />
              {!chip.wordmark && chip.name}
            </span>
          ))}
        </div>
        <div className="ticker" aria-hidden="true">
          <ul>
            {[0, 1].map((copy) =>
              TICKS.map((tick) => (
                <li key={`${copy}${tick.path}`}>
                  <span>
                    <Logo files={tick} />
                  </span>
                  <span className={tick.tone}>{tick.code}</span>
                  <span>{tick.path}</span>
                  <span>{tick.ms}</span>
                </li>
              )),
            )}
          </ul>
        </div>
      </div>
    </Reveal>
  )
}

/** The fault matrix tile: the planned faults right under the text, the tally at the foot. */
function FaultsTile() {
  return (
    <Reveal as="article" className="tile t-dark t-faults c2">
      <h3>Fault matrix</h3>
      <p>
        The faults the test's own steps could meet, planned from what they called, grouped and kept
        within a budget.
      </p>
      <div className="art">
        <div className="faults">
          {FAULTS.map(([fault, broke]) => (
            <div key={fault} className={broke ? "bad" : undefined}>
              <span>{fault}</span>
              <span className={broke ? undefined : "kind"}>{broke ? "broke" : "held"}</span>
            </div>
          ))}
        </div>
        <div className="tally">
          <div className="meter">
            <i style={{ width: "94.4%" }} />
            <i className="r" style={{ width: "5.6%" }} />
          </div>
          <span>
            <b>17 of 18</b> held · 1 broke the invariant
          </span>
        </div>
      </div>
    </Reveal>
  )
}

function ReplayTile() {
  return (
    <Reveal as="article" className="tile c2">
      <h3>Replay without model calls</h3>
      <p>The agent's choices are cached as locators. Reruns are deterministic, fast and free.</p>
      <div className="art">
        <div className="stat">
          0<small>model calls</small>
        </div>
        <div className="replay-row">
          <span>
            act <b>cached</b>
          </span>
          <span>
            assert <b>cached</b>
          </span>
          <span>
            act <b>cached</b>
          </span>
          <span>$0.00</span>
        </div>
      </div>
    </Reveal>
  )
}

/** The flight recorder tile's lanes: label, then bars as left, width and colour. */
const RECORD: readonly (readonly [string, readonly (readonly [number, number, string])[]])[] = [
  ["step", [[0, 30, "var(--text-2)"]]],
  ["stripe", [[8, 26, "var(--s1)"]]],
  ["webhook", [[38, 18, "var(--s2)"]]],
  [
    "postgres",
    [
      [44, 8, "var(--s3)"],
      [60, 8, "var(--s3)"],
    ],
  ],
  ["expect", [[70, 30, "var(--red)"]]],
]

function RecorderTile() {
  return (
    <Reveal as="article" className="tile c2">
      <h3>Flight recorder</h3>
      <p>
        Steps, screenshots, a provider waterfall, the effects diff and emulator state, secrets
        redacted.
      </p>
      <div className="art rec">
        {RECORD.map(([label, bars]) => (
          <span key={label} style={{ display: "contents" }}>
            <span>{label}</span>
            <span className="tr">
              {bars.map(([left, width, colour]) => (
                <i
                  key={left}
                  style={{ left: `${left}%`, width: `${width}%`, background: colour }}
                />
              ))}
            </span>
          </span>
        ))}
      </div>
    </Reveal>
  )
}

function MobileTile() {
  return (
    <Reveal as="article" className="tile c2">
      <h3>Mobile</h3>
      <p>
        The same tests, invariants and matrix on React Native and Expo apps for Android and iOS,
        in-app checkout browsers included.
      </p>
      <div className="art">
        <div className="phone">
          <div className="scr">
            <div className="bar-top">
              <img src="/icons/stripe.svg" alt="" />
              checkout.stripe.com
            </div>
            <div className="ln" style={{ width: "55%" }} />
            <div className="ln" style={{ width: "80%", opacity: 0.6 }} />
            <div className="ln" style={{ width: "70%", opacity: 0.6 }} />
            <div className="pay">
              Pay $5.00
              <span className="tap" />
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  )
}

function McpTile() {
  return (
    <Reveal as="article" className="tile c3">
      <h3>MCP for coding agents</h3>
      <p>
        Claude Code, Cursor and Codex run, explain and write danwo tests through MCP, then fix what
        the matrix found.
      </p>
      <div className="art chat">
        <div className="msg me">Make checkout survive the matrix</div>
        <div className="tool">
          <i />
          <b>run_matrix</b> tests/buy-credits · 1 of 18 broke
        </div>
        <div className="tool">
          <i />
          <b>show_run</b> duplicate webhook granted credits twice
        </div>
        <div className="msg">
          The webhook handler had no idempotency check. I keyed it on <code>event.id</code>; the
          matrix now passes 18 of 18.
        </div>
      </div>
    </Reveal>
  )
}

/** A check run row: passed or failed, what ran, how long it took. */
function CheckRow({
  ok,
  children,
  time,
}: {
  readonly ok: boolean
  readonly children: ReactNode
  readonly time: string
}) {
  return (
    <div className="check-row">
      <span className={ok ? "ic v" : "ic x"}>{ok ? <CheckIcon /> : <CrossIcon />}</span>
      <span className="t">{children}</span>
      <span className="mu">{time}</span>
    </div>
  )
}

function GithubTile() {
  return (
    <Reveal as="article" className="tile c3">
      <h3>GitHub Check and PR comment</h3>
      <p>
        Every pull request gets a check run and a comment: what broke, under which fault, with the
        flight record one click away.
      </p>
      <div className="art check">
        <CheckRow ok={false} time="25.4s">
          <b>danwo matrix</b> · broke under 1 of 18 faults
        </CheckRow>
        <CheckRow ok time="8.1s">
          <b>danwo test</b> · 42 passed, 3 cached
        </CheckRow>
        <CheckRow ok time="0.2s">
          <b>integration lint</b> · idempotency keys present
        </CheckRow>
      </div>
    </Reveal>
  )
}

/** Fidelity rows: provider, what was compared, how it came out. */
const FIDELITY: readonly (LogoFiles & {
  readonly what: string
  readonly result: string
  readonly tone: string
})[] = [
  { src: "stripe.svg", what: "POST /v1/checkout/sessions", result: "matched live", tone: "ok" },
  {
    src: "resend.svg",
    dark: "resend-on-dark.svg",
    what: "POST /emails",
    result: "matched live",
    tone: "ok",
  },
  { src: "s3.svg", what: "PUT and GET an object on Tigris", result: "matched live", tone: "ok" },
  {
    src: "clerk.svg",
    dark: "clerk-on-dark.svg",
    what: "sign-in by emailed code",
    result: "matched live",
    tone: "ok",
  },
  { src: "paystack.svg", what: "GET /transaction/verify", result: "matched live", tone: "ok" },
]

function FidelityTile() {
  return (
    <Reveal as="article" className="tile c6">
      <div className="fid-grid">
        <div>
          <h3>Fidelity checks</h3>
          <p>
            An emulator is only worth what it matches. danwo compares every emulator with the real
            API by structure, from the provider's published description and its live answers, so a
            green run means what it says.
          </p>
        </div>
        <div className="fid">
          {FIDELITY.map((row) => (
            <div key={row.what}>
              <Logo files={row} />
              <span>{row.what}</span>
              <span className={row.tone}>{row.result}</span>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  )
}

export function Features() {
  return (
    <section className="feat tinted" id="features">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow" style={{ "--dot": "var(--s2)" }}>
            <i />
            Product
          </span>
        </Reveal>
        <Reveal as="h2">
          Other tools stop at the screen.
          <br />
          danwo keeps going.
        </Reveal>
        <Reveal as="p" className="lede">
          The page said "Thank you". Did Stripe charge once? Did the email send? Did the ledger add
          up? That is where apps break, and where danwo looks.
        </Reveal>
        <div className="bento">
          <EmulatorsTile />
          <FaultsTile />
          <ReplayTile />
          <RecorderTile />
          <MobileTile />
          <McpTile />
          <GithubTile />
          <FidelityTile />
        </div>
      </div>
    </section>
  )
}
