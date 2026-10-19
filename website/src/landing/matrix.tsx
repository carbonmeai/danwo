/**
 * The hero's fault matrix: rows are what a clean run of the shop's checkout test touched,
 * columns the faults planned against them. Trials fill in one at a time, the duplicate webhook
 * breaks the invariant, and the run starts over.
 */
import { type ReactNode, useCallback, useRef, useState } from "react"

import { AppIcon, ClockIcon } from "./glyphs.tsx"
import { useInView, useReducedMotion, useTicker } from "./motion.ts"

const COLUMNS = [
  "status 500",
  "status 429",
  "reset",
  "timeout",
  "delay",
  "duplicate",
  "forged",
  "stale",
  "late",
  "double-submit",
  "COMMIT fails",
  "+30 days",
]

/** A group heading, or a row with the columns that apply to it. */
type Row =
  | { readonly group: string }
  | { readonly label: string; readonly icon: ReactNode; readonly faults: readonly number[] }

const icon = (file: string) => <img src={`/icons/${file}`} alt="" />

const ROWS: readonly Row[] = [
  { group: "Provider calls" },
  { label: "POST /v1/checkout/sessions", icon: icon("stripe.svg"), faults: [0, 1, 2, 3] },
  { label: "GET checkout.stripe.com", icon: icon("stripe.svg"), faults: [0, 2, 3] },
  { label: "POST /emails", icon: icon("resend-on-dark.svg"), faults: [0, 1, 3] },
  { group: "Webhooks" },
  { label: "checkout.session.completed", icon: icon("stripe.svg"), faults: [4, 5, 6, 7, 8] },
  { group: "Races, data and time" },
  { label: "POST /buy", icon: <AppIcon />, faults: [9] },
  { label: "UPDATE credits", icon: icon("postgresql.svg"), faults: [10] },
  { label: "clock", icon: <ClockIcon />, faults: [11] },
]

/** The trial that breaks the invariant: the duplicated checkout webhook. */
const BROKEN = { row: "checkout.session.completed", column: 5 }

/** Every trial, in the order the matrix runs them: column by column. */
const TRIALS = ROWS.flatMap((row) =>
  "faults" in row ? row.faults.map((column) => ({ row: row.label, column })) : [],
).toSorted((a, b) => a.column - b.column)

const TOTAL = TRIALS.length
const PAUSE_TICKS = 20

/** Where in the run a trial is: not run, running, held or broke. */
function trialState(index: number, done: number): string {
  if (index === done) return " scan"
  if (index > done) return ""

  const trial = TRIALS[index]

  return trial?.row === BROKEN.row && trial.column === BROKEN.column ? " fail" : " pass"
}

/** The matrix pane: its heading and badge, the grid, and the tally under it. */
export function HeroMatrix() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const visible = useInView(ref)
  const [tick, setTick] = useState(0)
  const step = useCallback(() => setTick((value) => (value + 1) % (TOTAL + PAUSE_TICKS)), [])

  useTicker(visible && !reduce, 210, step)

  const done = reduce ? TOTAL : Math.min(tick, TOTAL)
  const finished = done >= TOTAL
  const broke = TRIALS.slice(0, done).filter(
    (trial) => trial.row === BROKEN.row && trial.column === BROKEN.column,
  ).length
  const scanning = finished ? undefined : TRIALS[done]?.column

  return (
    <>
      <div className="pane-h">
        <h3>
          Fault matrix <span>· one clean run, replayed per fault</span>
        </h3>
        <span className={finished ? "badge b-fail" : "badge b-run"}>
          {finished ? "1 broke" : "running"}
        </span>
      </div>
      <div className="mx-scroll">
        <div
          className="mx"
          ref={ref}
          role="img"
          aria-label="Fault matrix: 17 of 18 faults held; a duplicate checkout.session.completed webhook broke the invariant"
        >
          <div />
          {COLUMNS.map((column, i) => (
            <div key={column} className={i === scanning ? "colh on" : "colh"} title={column}>
              <span>{column}</span>
            </div>
          ))}
          {ROWS.map((row) =>
            "group" in row ? (
              <div key={row.group} className="grp">
                {row.group}
              </div>
            ) : (
              <MatrixRow key={row.label} row={row} done={done} />
            ),
          )}
        </div>
      </div>
      <div className="mx-foot">
        <span className="big">
          {finished ? "Broke under 1 of 18 faults" : `Trial ${done} of ${TOTAL}`}
        </span>
        <div className="meter">
          <i style={{ width: `${((done - broke) / TOTAL) * 100}%` }} />
          <i className="r" style={{ width: `${(broke / TOTAL) * 100}%` }} />
        </div>
      </div>
      <div className="legend">
        <span>
          <i style={{ background: "#00c950" }} />
          held under the fault
        </span>
        <span>
          <i style={{ background: "#e5484d" }} />
          the fault broke it
        </span>
        <span>
          <i style={{ background: "#e8e8e81a" }} />
          not applicable
        </span>
      </div>
    </>
  )
}

/** One row of the matrix: its label, then a cell per column. */
function MatrixRow({
  row,
  done,
}: {
  readonly row: Extract<Row, { label: string }>
  readonly done: number
}) {
  return (
    <>
      <div className="rowh">
        {row.icon}
        <span>{row.label}</span>
      </div>
      {COLUMNS.map((column, i) => {
        const index = TRIALS.findIndex((trial) => trial.row === row.label && trial.column === i)

        return (
          <div
            key={column}
            className={index === -1 ? "cell" : `cell ap${trialState(index, done)}`}
          />
        )
      })}
    </>
  )
}
