/** The closing call to action. */
import { Link } from "@tanstack/react-router"

import { repoUrl } from "../lib/site.ts"
import { CopyBox } from "./copy.tsx"

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
