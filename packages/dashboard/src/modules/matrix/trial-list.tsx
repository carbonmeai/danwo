import type { MatrixHistory } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"
import { useEffect, useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { ListRow, ListRows, Panel } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { useListKeys } from "../../lib/list-keys.ts"
import { listedTrials } from "./matrix-values.ts"

/** The trials as a list, failures first, each with what went wrong. */
export function TrialList({
  run,
  focus,
}: {
  readonly run: MatrixHistory
  /** The trial the page's address points at, by its fault. */
  readonly focus?: string | undefined
}) {
  const trials = listedTrials(run)
  const list = useRef<HTMLDivElement>(null)
  const current = useListKeys(list, trials.length)

  useEffect(() => {
    if (focus === undefined) return

    list.current
      ?.querySelector(`[data-trial="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: "center" })
  }, [focus])

  return (
    <Panel px="1.5" py="1.5">
      <ListRows ref={list} aria-label="Faults">
        {trials.map((trial, i) => (
          <ListRow
            key={trial.fault}
            data-row
            data-trial={trial.fault}
            data-status={trial.status}
            bg={i === current || trial.fault === focus ? "surface.itemHover" : "surface.item"}
            boxShadow={
              i === current || trial.fault === focus
                ? "inset 2px 0 0 {colors.ink.strong}"
                : undefined
            }
            display="grid"
            gridTemplateColumns={{ base: "1fr", md: "8rem minmax(0, 1fr) 14rem" }}
            gap="3"
            alignItems="center"
          >
            <Box>
              <StatusBadge status={trial.status} />
            </Box>
            <Stack gap="1" minW="0">
              <Link
                to="/runs/$runId"
                params={{ runId: run.id }}
                search={{ view: "list", trial: trial.fault ?? undefined }}
                replace
                title="A link to this trial"
              >
                <Ident fontWeight="500">{trial.fault}</Ident>
              </Link>
              {trial.error ? (
                <Box color="verdict.failed.fg" fontSize="1" lineClamp="2">
                  {trial.error}
                </Box>
              ) : null}
            </Stack>
            <HStack gap="2" justify={{ md: "flex-end" }} color="ink.muted" fontSize="1">
              <Span>
                {trial.calls} calls, {trial.deliveries} webhooks
              </Span>
              {trial.record ? (
                <Button asChild variant="ghost" size="icon" tooltipChildren="Watch this trial">
                  <Link
                    to="."
                    search={(prev) => ({ ...prev, open: trial.record })}
                    resetScroll={false}
                    aria-label="Watch"
                  >
                    <Icons.play size={14} />
                  </Link>
                </Button>
              ) : null}
            </HStack>
          </ListRow>
        ))}
      </ListRows>
    </Panel>
  )
}
