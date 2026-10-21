/** Running danwo yourself, and the hosted version to come. */
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { licenceWords, repoUrl, SITE } from "../lib/site.ts"
import { CheckIcon } from "./glyphs.tsx"
import { Reveal } from "./reveal.tsx"

function Item({ children }: { readonly children: ReactNode }) {
  return (
    <li>
      <CheckIcon />
      {children}
    </li>
  )
}

export function Plans() {
  const github = repoUrl()

  return (
    <section className="oss" id="oss">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow" style={{ "--dot": "var(--green)" }}>
            <i />
            {licenceWords()}
          </span>
        </Reveal>
        <Reveal as="h2">Yours to run. Ours to host, if you like.</Reveal>
        <Reveal as="p" className="lede">
          The whole engine runs on your machines: runner, emulators, matrix, recorder and dashboard.
          The cloud adds history and a team around it.
        </Reveal>
        <div className="plans">
          <Reveal className="plan">
            <span className="tag">self-host</span>
            <h3>{SITE.licence.openSource ? "Open source" : "Self-hosted"}</h3>
            <p>
              Everything that runs a test, on your laptop or in your CI. Nothing leaves your
              machines.
            </p>
            <ul>
              <Item>All emulators, faults and the matrix</Item>
              <Item>
                Local dashboard with <code>danwo serve</code>
              </Item>
              <Item>GitHub Check and pull request comment, MCP server</Item>
              <Item>
                Drop into Playwright Test with <code>@danwo/playwright</code>
              </Item>
            </ul>
            <div className="term-mini">
              <span className="pr">$</span> npx @danwo/cli init{"\n"}
              <span className="pr">$</span> npx @danwo/cli matrix tests/buy-credits.danwo.ts{"\n"}
              <span className="pr">$</span> npx @danwo/cli serve
            </div>
            <div className="row">
              {github ? (
                <a className="btn btn-solid" href={github}>
                  Star on GitHub
                </a>
              ) : (
                <Link className="btn btn-solid" to="/docs/$" params={{ _splat: "quickstart" }}>
                  Install danwo
                </Link>
              )}
              <Link className="btn btn-soft" to="/docs/$" params={{ _splat: "test-a-provider" }}>
                Test a provider
              </Link>
            </div>
          </Reveal>
          <Reveal className="plan dark">
            <span className="tag">cloud · coming</span>
            <h3>danwo Cloud</h3>
            <p>The same engine, with the history your team needs to trust it.</p>
            <ul>
              <Item>Run history, flaky-test insights and impact</Item>
              <Item>Hosted flight records, shareable per pull request</Item>
              <Item>Matrix runs fanned out across workers</Item>
              <Item>Teams, single sign-on and model-spend tracking</Item>
            </ul>
            {!SITE.waitlistUrl && !SITE.contactUrl && (
              <p className="soon">Not open yet. Everything above runs self-hosted today.</p>
            )}
            <div className="row">
              {SITE.waitlistUrl && (
                <a className="btn btn-solid" href={SITE.waitlistUrl}>
                  Join the waitlist
                </a>
              )}
              {SITE.contactUrl && (
                <a className="btn btn-soft" href={SITE.contactUrl}>
                  Talk to us
                </a>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
