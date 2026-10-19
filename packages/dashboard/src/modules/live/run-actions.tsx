import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { useNavigate } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useState } from "react"

import { Button } from "../../components/controls.tsx"
import type { RunRequest } from "./launch-args.ts"
import { cancelRunFn, startRunFn } from "./live-api.ts"

/** What the last start came to, for the line beside the buttons. */
type Outcome =
  | { readonly kind: "queued"; readonly position: number }
  | { readonly kind: "error"; readonly message: string }

const ORDINAL = ["", "next", "2nd", "3rd", "4th", "5th"]

function OutcomeLine({ outcome }: { readonly outcome: Outcome | undefined }) {
  if (outcome === undefined) return null

  return outcome.kind === "queued" ? (
    <styled.span color="ink.muted" fontSize="1" role="status">
      Queued, {ORDINAL[outcome.position] ?? `${outcome.position}th`} in line: another run is going
    </styled.span>
  ) : (
    <styled.span
      color="verdict.failed.fg"
      fontSize="1"
      role="alert"
      maxW="28rem"
      lineClamp="3"
      title={outcome.message}
    >
      {outcome.message}
    </styled.span>
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
        type="button"
        look="primary"
        disabled={pending}
        onClick={() => void start({ action: "rerun-failed", runId })}
      >
        <Icons.refresh size={14} />
        Rerun {failed} failed
      </Button>
    </ActionRow>
  )
}

/** Runs one test again, on its own. */
export function RerunTest({
  testId,
  look = "ghost",
}: {
  readonly testId: string
  readonly look?: "ghost" | "grey"
}) {
  const { start, pending, outcome } = useStartRun()

  return (
    <ActionRow outcome={outcome}>
      <Button
        type="button"
        look={look}
        h="7"
        disabled={pending}
        aria-label={`Rerun ${testId}`}
        title="Run this test again"
        onClick={() => void start({ action: "test", testId })}
      >
        <Icons.play size={13} />
        Rerun
      </Button>
    </ActionRow>
  )
}

const FilterBox = styled("input", {
  base: {
    h: "8",
    px: "2.5",
    w: "15rem",
    rounded: "lg",
    bg: "surface.hover",
    color: "ink.strong",
    fontSize: "1",
    outline: "none",
    _placeholder: { color: "ink.faint" },
    _focus: { bg: "surface.panel", boxShadow: "0 0 0 3px {colors.ring}" },
  },
})

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
    void start({ action: "matrix", testId, faults: filter })
  }

  return (
    <ActionRow outcome={outcome}>
      {open ? (
        <styled.form display="flex" gap="2" onSubmit={submit} aria-label="Run the matrix">
          <FilterBox
            autoFocus
            type="text"
            placeholder="Only faults containing…"
            aria-label="Only faults containing"
            value={filter}
            maxLength={120}
            onChange={(event) => setFilter(event.target.value)}
          />
          <Button type="submit" look="primary" disabled={pending}>
            <Icons.play size={13} />
            Run
          </Button>
          <Button type="button" look="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </styled.form>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Icons.grid size={14} />
          Run the matrix
        </Button>
      )}
    </ActionRow>
  )
}

/** Stops a run that is still going: its workers, browsers and app go with it. */
export function CancelRun({ runId }: { readonly runId: string }) {
  const [state, setState] = useState<"idle" | "asking" | "stopping" | "gone">("idle")

  if (state === "gone") return null

  return (
    <HStack gap="2">
      {state === "asking" ? (
        <styled.span color="ink.muted" fontSize="1">
          Stop this run?
        </styled.span>
      ) : null}
      <Button
        type="button"
        look={state === "asking" ? "primary" : "grey"}
        disabled={state === "stopping"}
        onClick={() => {
          if (state === "idle") return setState("asking")

          setState("stopping")
          void cancelRunFn({ data: runId }).then((result) =>
            setState(result.cancelled ? "gone" : "idle"),
          )
        }}
      >
        <Icons.stop size={13} />
        {state === "asking" ? "Stop it" : state === "stopping" ? "Stopping…" : "Cancel"}
      </Button>
    </HStack>
  )
}

/** The actions on a flight record: run its test again, or its matrix, from where it is read. */
export function RecordDock({ testId }: { readonly testId: string }) {
  return (
    <Box
      position="fixed"
      right={{ base: "3", md: "6" }}
      bottom={{ base: "3", md: "6" }}
      zIndex="5"
      bg="surface.chip"
      boxShadow="pop"
      rounded="12px"
      p="1.5"
    >
      <Stack direction="row" gap="1" alignItems="center">
        <RerunTest testId={testId} look="grey" />
        <RunMatrix testId={testId} />
      </Stack>
    </Box>
  )
}
