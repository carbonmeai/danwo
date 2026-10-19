import { Icons } from "@danwo/ui/icons/base"
import { HStack } from "@danwo/ui/jsx"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@danwo/ui/primitives/alert-dialog"
import { Button } from "@danwo/ui/primitives/button"
import { Input } from "@danwo/ui/primitives/input"
import { Popover, PopoverContent, PopoverTrigger } from "@danwo/ui/primitives/popover"
import { Span } from "@danwo/ui/primitives/typography"
import { useNavigate } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useState } from "react"

import type { RunRequest } from "./launch-args.ts"
import { cancelRunFn, startRunFn } from "./live-api.ts"
import { useActiveRuns } from "./use-live.ts"

/** What the last start came to, for the line beside the buttons. */
type Outcome =
  | { readonly kind: "queued"; readonly position: number }
  | { readonly kind: "error"; readonly message: string }

const ORDINAL = ["", "next", "2nd", "3rd", "4th", "5th"]

function OutcomeLine({ outcome }: { readonly outcome: Outcome | undefined }) {
  if (outcome === undefined) return null

  return outcome.kind === "queued" ? (
    <Span color="ink.muted" fontSize="1" role="status">
      Queued, {ORDINAL[outcome.position] ?? `${outcome.position}th`} in line: another run is going
    </Span>
  ) : (
    <Span
      color="verdict.failed.fg"
      fontSize="1"
      role="alert"
      maxW="28rem"
      lineClamp="3"
      title={outcome.message}
    >
      {outcome.message}
    </Span>
  )
}

/** Starts runs: a run that starts opens its live page; one that waits or fails says so. */
function useStartRun() {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>()

  const start = async (request: RunRequest) => {
    setPending(true)
    setOutcome(undefined)

    try {
      const result = await startRunFn({ data: request })

      if ("started" in result)
        await navigate({ to: "/runs/$runId", params: { runId: result.started } })
      else if ("queued" in result) setOutcome({ kind: "queued", position: result.queued })
      else setOutcome({ kind: "error", message: result.error })
    } catch (error) {
      setOutcome({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    } finally {
      setPending(false)
    }
  }

  return { start, pending, outcome }
}

/** A row of run buttons with what the last one came to beside them. */
function ActionRow({
  outcome,
  children,
}: {
  readonly outcome: Outcome | undefined
  readonly children: ReactNode
}) {
  return (
    <HStack gap="2" flexWrap="wrap" justify="flex-end">
      <OutcomeLine outcome={outcome} />
      {children}
    </HStack>
  )
}

/** Runs a finished test run's failed tests again. */
export function RerunFailed({
  runId,
  failed,
}: {
  readonly runId: string
  readonly failed: number
}) {
  const { start, pending, outcome } = useStartRun()

  if (failed === 0) return null

  return (
    <ActionRow outcome={outcome}>
      <Button
        variant="solid"
        size="sm"
        isLoading={pending}
        onClick={() => void start({ action: "rerun-failed", runId })}
      >
        <Icons.rotateCw size={14} />
        Rerun {failed} failed
      </Button>
    </ActionRow>
  )
}

/**
 * Runs one test again, on its own: a labelled button, or in a table row an icon button with the
 * same name and a tooltip.
 */
export function RerunTest({
  testId,
  compact = false,
}: {
  readonly testId: string
  readonly compact?: boolean
}) {
  const { start, pending, outcome } = useStartRun()

  return (
    <ActionRow outcome={outcome}>
      <Button
        variant={compact ? "ghost" : "soft"}
        size={compact ? "icon" : "sm"}
        isLoading={pending}
        aria-label={`Rerun ${testId}`}
        tooltipChildren="Run this test again"
        onClick={() => void start({ action: "test", testId })}
      >
        <Icons.rotateCw size={14} />
        {compact ? null : "Rerun"}
      </Button>
    </ActionRow>
  )
}

/** Runs the picked tests, or every test when none is picked. */
export function RunTests({ testIds }: { readonly testIds: readonly string[] }) {
  const { start, pending, outcome } = useStartRun()
  const label = testIds.length === 0 ? "Run all" : `Run ${testIds.length} selected`

  return (
    <ActionRow outcome={outcome}>
      <Button
        variant="solid"
        size="sm"
        isLoading={pending}
        onClick={() => void start({ action: "tests", testIds })}
      >
        <Icons.play size={13} />
        {label}
      </Button>
    </ActionRow>
  )
}

/**
 * Runs the matrix for one test, every planned fault or only those whose label holds the words
 * typed, matched literally.
 */
export function RunMatrix({
  testId,
  faults = "",
}: {
  readonly testId: string
  readonly faults?: string
}) {
  const { start, pending, outcome } = useStartRun()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState(faults)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setOpen(false)
    void start({ action: "matrix", testId, faults: filter })
  }

  return (
    <ActionRow outcome={outcome}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="soft" size="sm" isLoading={pending}>
            <Icons.grid size={14} />
            Run the matrix
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" p="3" w="20rem">
          <form onSubmit={submit} aria-label="Run the matrix">
            <HStack gap="2">
              <Input
                autoFocus
                size="sm"
                placeholder="Only faults containing…"
                aria-label="Only faults containing"
                value={filter}
                maxLength={120}
                onChange={(event) => setFilter(event.target.value)}
              />
              <Button type="submit" variant="solid" size="sm">
                <Icons.play size={13} />
                Run
              </Button>
            </HStack>
          </form>
        </PopoverContent>
      </Popover>
    </ActionRow>
  )
}

/** Stops every run still going in the project, shown only while one is. */
export function StopAll() {
  const active = useActiveRuns()?.active ?? []
  const [stopping, setStopping] = useState(false)

  if (active.length === 0) return null

  return (
    <Button
      variant="soft"
      size="sm"
      isLoading={stopping}
      loadingText="Stopping…"
      onClick={() => {
        setStopping(true)
        void Promise.all(active.map((run) => cancelRunFn({ data: run.id }))).finally(() =>
          setStopping(false),
        )
      }}
    >
      <Icons.stop size={13} />
      {active.length === 1 ? "Stop the run" : `Stop all ${active.length}`}
    </Button>
  )
}

/** Stops a run that is still going, after asking: its workers, browsers and app go with it. */
export function CancelRun({ runId }: { readonly runId: string }) {
  const [state, setState] = useState<"idle" | "stopping" | "gone">("idle")

  if (state === "gone") return null

  const stop = () => {
    setState("stopping")
    void cancelRunFn({ data: runId }).then((result) => setState(result.cancelled ? "gone" : "idle"))
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="soft" size="sm" isLoading={state === "stopping"} loadingText="Stopping…">
          <Icons.stop size={13} />
          Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent p="5" w="26rem">
        <AlertDialogTitle fontWeight="600">Stop this run?</AlertDialogTitle>
        <AlertDialogDescription mt="2" fontSize="1.5" color="ink.muted">
          Its workers, browsers and app stop with it. What it recorded so far is kept.
        </AlertDialogDescription>
        <HStack justify="flex-end" mt="5" gap="2">
          <AlertDialogCancel asChild>
            <Button variant="ghost" size="sm">
              Keep running
            </Button>
          </AlertDialogCancel>
          <Button variant="solid" size="sm" onClick={stop}>
            <Icons.stop size={13} />
            Stop it
          </Button>
        </HStack>
      </AlertDialogContent>
    </AlertDialog>
  )
}
