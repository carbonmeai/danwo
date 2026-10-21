/** Code samples: the example shop's real test and config, and what `danwo matrix` prints. */
import { type KeyboardEvent, useRef, useState } from "react"
import samples from "virtual:danwo/code-samples"

import { useCopy } from "./copy.tsx"
import { Reveal } from "./reveal.tsx"

/** A matrix run's output, as the terminal tab shows it. */
function MatrixOutput() {
  return (
    <div className="term">
      <span className="pr">$</span>{" "}
      <span className="w">npx @danwo/cli matrix tests/buy-credits.danwo.ts</span>
      {"\n\n"}
      <span className="d">{"  clean run"}</span>
      {"   "}
      <span className="g">✓</span> buys 500 credits through Stripe Checkout{" "}
      <span className="d">1.4s · 0 model calls</span>
      {"\n"}
      <span className="d">{"  planned"}</span>
      {"     18 faults from 4 provider calls, 1 webhook, 2 races\n\n"}
      {[
        ["status 500    ", "POST api.stripe.com/v1/checkout/sessions"],
        ["status 429    ", "POST api.stripe.com/v1/checkout/sessions"],
        ["reset         ", "GET  checkout.stripe.com/c/pay/cs_test_…"],
        ["delay 5s      ", "webhook checkout.session.completed"],
      ].map(([fault, where]) => (
        <span key={`${fault}${where}`}>
          {"  "}
          <span className="g">✓</span> {fault} <span className="d">{where}</span>
          {"\n"}
        </span>
      ))}
      {"  "}
      <span className="r">✗</span> <span className="w">duplicate</span>
      {"      "}
      <span className="d">webhook checkout.session.completed</span>
      {"\n      "}
      <span className="r">invariant: expected 1000 to be 500</span>
      {"\n      "}
      <span className="d">record →</span> <span className="b">danwo show --open</span>
      {"\n"}
      {[
        ["forged        ", "webhook checkout.session.completed"],
        ["stale         ", "webhook checkout.session.completed"],
        ["double-submit ", "POST /buy"],
      ].map(([fault, where]) => (
        <span key={`${fault}${where}`}>
          {"  "}
          <span className="g">✓</span> {fault} <span className="d">{where}</span>
          {"\n"}
        </span>
      ))}
      <span className="d">{"  … 9 more held"}</span>
      {"\n\n"}
      <span className="r">{"  Broke under 1 of 18 faults"}</span>
      {"  "}
      <span className="d">25.4s · 2 workers</span>
      {"\n"}
      <span className="d">{"  Open the matrix:"}</span> <span className="b">danwo serve</span>
    </div>
  )
}

const TABS = [...samples.map((sample) => sample.label), "danwo matrix"]

export function CodeSection() {
  const [selected, setSelected] = useState(0)
  const [copied, copy] = useCopy()
  const panel = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const sample = samples[selected]

  const onKey = (event: KeyboardEvent, index: number) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0

    if (delta === 0) return

    const next = (index + delta + TABS.length) % TABS.length

    setSelected(next)
    tabs.current[next]?.focus()
  }

  return (
    <section className="code-sect" id="code">
      <div className="wrap code-grid">
        <div className="code-copy">
          <Reveal>
            <span className="eyebrow" style={{ "--dot": "var(--s3)" }}>
              <i />
              In code
            </span>
          </Reveal>
          <Reveal as="h2">Tests that read like the product.</Reveal>
          <Reveal as="p" className="lede">
            TypeScript, a Playwright-shaped API, and an invariant that judges the backend rather
            than the pixels.
          </Reveal>
          <Reveal>
            <ul>
              <li>
                <span className="num">1</span>
                <span>
                  <b>Locators or the agent.</b> Mix <code>screen.getByRole</code> with{" "}
                  <code>agent.act</code>; both replay without a model.
                </span>
              </li>
              <li>
                <span className="num">2</span>
                <span>
                  <b>One environment function.</b> Emulators and the proxy, wired into the app by
                  environment variables.
                </span>
              </li>
              <li>
                <span className="num">3</span>
                <span>
                  <b>Run the matrix.</b> Locally, in CI, or from your coding agent.
                </span>
              </li>
            </ul>
          </Reveal>
        </div>
        <Reveal className="ide">
          <div className="tabs" role="tablist" aria-label="Code samples">
            {TABS.map((label, i) => (
              <button
                key={label}
                ref={(element) => {
                  tabs.current[i] = element
                }}
                type="button"
                className="tab"
                role="tab"
                aria-selected={i === selected}
                tabIndex={i === selected ? 0 : -1}
                onClick={() => setSelected(i)}
                onKeyDown={(event) => onKey(event, i)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="cp-code"
              onClick={() => copy(panel.current?.innerText ?? "")}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="panel" role="tabpanel" ref={panel} key={selected}>
            {sample ? <div dangerouslySetInnerHTML={{ __html: sample.html }} /> : <MatrixOutput />}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
