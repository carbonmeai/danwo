/** The closing call to action and the footer. */
import { Link } from "@tanstack/react-router"

import { Lockup } from "../components/brand.tsx"
import { repoUrl, SITE } from "../lib/site.ts"
import { CopyBox } from "./copy.tsx"
import { WordmarkBand } from "./wordmark-band.tsx"

export function Closing() {
  const github = repoUrl()

  return (
    <section className="cta">
      <div className="wrap">
        <div className="cta-mx" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} className={i === 5 ? "x" : undefined} />
          ))}
        </div>
        <h2>Find the fault before your users do.</h2>
        <p>One command sets danwo up in your project, for you and for your coding agents.</p>
        <div className="ctas">
          <CopyBox command="npx danwo init" />
          {github && (
            <a className="btn btn-solid" href={github}>
              GitHub
            </a>
          )}
          <Link className="btn btn-soft" to="/docs/$" params={{ _splat: "" }}>
            Docs
          </Link>
        </div>
      </div>
    </section>
  )
}

/** A footer column: its heading and links. */
function Column({
  title,
  links,
}: {
  readonly title: string
  readonly links: readonly (readonly [string, string])[]
}) {
  return (
    <div>
      <h4>{title}</h4>
      {links.map(([text, href]) => (
        <a key={text} href={href}>
          {text}
        </a>
      ))}
    </div>
  )
}

export function Footer() {
  const github = repoUrl()

  return (
    <footer>
      <WordmarkBand />
      <div className="wrap">
        <div className="foot">
          <div>
            <Link className="danwo-brand home" to="/" aria-label="dánwò home">
              <Lockup height={26} className="on-dark" />
            </Link>
            <p style={{ margin: "14px 0 0", maxWidth: 260 }}>
              {SITE.tagline} Testing for the agentic era.
            </p>
          </div>
          <Column
            title="Product"
            links={[
              ["Emulators", "/docs/providers"],
              ["Fault matrix", "/docs/fault-matrix"],
              ["Flight recorder", "/docs/flight-records"],
              ["Mobile", "/docs/mobile"],
            ]}
          />
          <Column
            title="Developers"
            links={[
              ["Docs", "/docs"],
              ["Quickstart", "/docs/first-test"],
              ["MCP", "/docs/coding-agents"],
              ["Playwright", "/docs/playwright"],
            ]}
          />
          <Column
            title="Project"
            links={[
              ...(github ? [["GitHub", github] as const] : []),
              ["Changelog", "/changelog"],
              ["Fidelity", "/docs/fidelity"],
              ["llms.txt", "/llms.txt"],
            ]}
          />
          <Column
            title="Read"
            links={[
              ["Blog", "/blog"],
              ["Why danwo", "/docs/why-danwo"],
              ["CLI reference", "/docs/reference/cli"],
            ]}
          />
        </div>
        <div className="foot-b">
          <span>© {new Date().getFullYear()} danwo</span>
          <span className="status-dot">Every emulator checked against its provider</span>
        </div>
      </div>
    </footer>
  )
}
