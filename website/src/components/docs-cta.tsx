/**
 * The small card under a docs page's table of contents: the cloud waitlist once there is one,
 * otherwise a pointer to running danwo in CI. It never links anywhere that is not live.
 */
import { Link } from "@tanstack/react-router"

import { SITE } from "../lib/site.ts"

export function DocsCta() {
  if (SITE.waitlistUrl !== undefined)
    return (
      <div className="danwo-cta">
        <p className="danwo-cta-title">danwo Cloud</p>
        <p>Runs, records and matrices for the whole team, without hosting them yourself.</p>
        <a className="danwo-cta-button" href={SITE.waitlistUrl}>
          Join the waitlist
        </a>
      </div>
    )

  return (
    <div className="danwo-cta">
      <p className="danwo-cta-title">Run it on every pull request</p>
      <p>A GitHub check and one comment per pull request, with the flight records attached.</p>
      <Link className="danwo-cta-button" to="/docs/$" params={{ _splat: "ci" }}>
        Set up CI
      </Link>
    </div>
  )
}
