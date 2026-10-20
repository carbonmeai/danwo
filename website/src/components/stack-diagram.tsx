/**
 * The real-stack diagram: a frontend, the API it calls and a background worker, each started by
 * danwo, with every call they make to the outside going through one proxy to the emulators and
 * local services.
 */
import type { ReactNode } from "react"

import { Arrow, Box, Figure, MUTED, TEXT } from "./diagrams.tsx"

const APPS = [
  { name: "web", note: "frontend", x: 170 },
  { name: "api", note: "backend", x: 330 },
  { name: "worker", note: "background jobs", x: 490 },
]

const BEHIND = ["Stripe, Clerk…", "Inngest dev", "Postgres, Redis"]

/** Several apps behind one proxy: what `stackEnvironment` starts and where their calls go. */
export function StackFlow(): ReactNode {
  return (
    <Figure
      width={760}
      height={270}
      label="The browser opens the frontend, which calls the API, which hands work to a worker. Every call any of them makes to the outside goes through danwo's proxy to emulators, the Inngest dev server and the databases."
      caption="danwo starts every app, in order, behind one proxy. What they call is emulated, recorded and can be faulted."
    >
      <Box x={10} y={20} width={120} label="Browser" note="your test" />
      <Arrow from={[130, 45]} to={[166, 45]} />
      {APPS.map((app, i) => (
        <g key={app.name}>
          <Box x={app.x} y={20} width={130} label={app.name} note={app.note} />
          {i < APPS.length - 1 && <Arrow from={[app.x + 130, 45]} to={[app.x + 156, 45]} />}
          <Arrow from={[app.x + 65, 70]} to={[app.x + 65, 146]} />
        </g>
      ))}
      <Box x={170} y={150} width={450} label="danwo proxy" note="one per worker" stroke={TEXT} />
      {BEHIND.map((name, i) => (
        <g key={name}>
          <Arrow from={[620, 175]} to={[646, 128 + i * 50]} />
          <Box x={650} y={110 + i * 50} width={100} label={name} />
        </g>
      ))}
      <text x={395} y={235} textAnchor="middle" style={{ fill: MUTED, fontSize: 11 }}>
        every app's calls, webhooks, sockets and statements go in the flight record
      </text>
    </Figure>
  )
}
