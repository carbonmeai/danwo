import type { HistoryTrial, MatrixHistory } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Span } from "@danwo/ui/primitives/typography"
import { Link, useNavigate } from "@tanstack/react-router"
import { Fragment, useState } from "react"

import { Ident } from "../../components/code.tsx"
import { Item, Panel } from "../../components/panel.tsx"
import { Swatch } from "../../components/status-badge.tsx"
import { toneOf, wordOf } from "../../lib/verdicts.ts"
import { faultGrid, type GridCell, gridGroups } from "./fault-grid.ts"
import { TrialDetail } from "./trial-detail.tsx"

const CELL = "2.5rem"

/** The ring a picked or hovered cell wears. */
const RING = "0 0 0 2px {colors.surface.page}, 0 0 0 4px {colors.ink.strong}"

/** A cell of the heatmap: one coloured block per trial that landed there, each a button. */
function Cell({
  cells,
  picked,
  onPick,
}: {
  readonly cells: readonly GridCell[]
  readonly picked: HistoryTrial | undefined
  readonly onPick: (trial: HistoryTrial) => void
}) {
  const navigate = useNavigate()

  if (cells.length === 0)
    return <Box w={CELL} h={CELL} rounded="6px" bg="surface.hover" aria-hidden="true" />

  return (
    <HStack gap="0.5" w={CELL} h={CELL} role="group">
      {cells.map(({ trial }) => {
        const words = `${trial.fault ?? "clean run"}: ${wordOf(trial.status)}`

        return (
          <Button
            key={trial.fault}
            variant="transparent"
            size="icon"
            flex="1"
            minW="0"
            w="auto"
            h="full"
            p="0"
            rounded="6px"
            transition="box-shadow 120ms"
            _hover={{ boxShadow: RING }}
            boxShadow={trial === picked ? RING : undefined}
            data-status={trial.status}
            data-picked={trial === picked || undefined}
            aria-label={words}
            tooltipChildren={words}
            onMouseEnter={() => onPick(trial)}
            onFocus={() => onPick(trial)}
            onClick={() => {
              if (trial.record)
                void navigate({
                  to: ".",
                  search: (prev: Record<string, unknown>) => ({ ...prev, open: trial.record }),
                  resetScroll: false,
                })
              else onPick(trial)
            }}
          >
            <Swatch tone={toneOf(trial.status)} w="full" h="full" rounded="6px" />
          </Button>
        )
      })}
    </HStack>
  )
}

/** The kinds of fault across the top, set on their side so the columns stay narrow. */
function ColumnHeads({ columns }: { readonly columns: readonly string[] }) {
  return (
    <Box role="row" display="contents">
      <Box role="columnheader" />
      {columns.map((column) => (
        <Box
          key={column}
          role="columnheader"
          h="7rem"
          display="flex"
          alignItems="flex-end"
          justifyContent="center"
          pb="2"
        >
          <Span
            fontSize="1"
            color="ink.muted"
            whiteSpace="nowrap"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {column}
          </Span>
        </Box>
      ))}
    </Box>
  )
}

/** The trials as a heatmap: what a fault landed on down the side, the kind of fault across. */
export function FaultHeatmap({
  run,
  focus,
  onPick,
}: {
  readonly run: MatrixHistory
  /** The trial the page's address points at, by its fault. */
  readonly focus?: string | undefined
  /** Hears each trial picked, as well as the panel beside the grid showing it. */
  readonly onPick?: (trial: HistoryTrial) => void
}) {
  const grid = faultGrid(run.trials)
  const groups = gridGroups(grid)
  const [picked, setPicked] = useState<HistoryTrial | undefined>(
    () =>
      run.trials.find((t) => t.fault === focus) ??
      run.trials.find((t) => toneOf(t.status) === "failed") ??
      run.trials[0],
  )
  const at = (row: string, column: string) =>
    grid.cells.filter((cell) => cell.row === row && cell.column === column)

  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", xl: "minmax(0, 1fr) 20rem" }}
      gap="2"
      alignItems="start"
    >
      <Panel overflowX="auto" px="5" pb="5">
        <Box
          display="grid"
          role="table"
          aria-label="Fault grid"
          style={{
            gridTemplateColumns: `minmax(10rem, 1fr) repeat(${grid.columns.length}, ${CELL})`,
          }}
          columnGap="1.5"
          rowGap="1.5"
          alignItems="center"
        >
          <ColumnHeads columns={grid.columns} />
          {groups.map((group) => (
            <Fragment key={group.kind}>
              <Box role="row" display="contents">
                <Box
                  role="rowheader"
                  gridColumn="1 / -1"
                  fontSize="1"
                  fontWeight="500"
                  color="ink.muted"
                  pt="3"
                  pb="1"
                >
                  {group.title}
                </Box>
              </Box>
              {group.rows.map((row) => (
                <Box role="row" display="contents" key={row.target}>
                  <Box role="rowheader" pr="4" minW="0">
                    <Ident
                      fontSize="1"
                      title={row.target}
                      display="block"
                      whiteSpace="nowrap"
                      overflow="hidden"
                      textOverflow="ellipsis"
                    >
                      {row.target}
                    </Ident>
                  </Box>
                  {grid.columns.map((column) => (
                    <Box role="cell" key={column}>
                      <Cell
                        cells={at(row.target, column)}
                        picked={picked}
                        onPick={(trial) => {
                          setPicked(trial)
                          onPick?.(trial)
                        }}
                      />
                    </Box>
                  ))}
                </Box>
              ))}
            </Fragment>
          ))}
        </Box>
      </Panel>
      <Panel position={{ xl: "sticky" }} top="16" aria-live="polite" aria-label="Trial">
        <Item p="4">
          <TrialDetail trial={picked} />
          {picked?.fault ? (
            <Box mt="3">
              <Button asChild variant="ghost" size="sm" ml="-1.5">
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.id }}
                  search={{ trial: picked.fault }}
                  replace
                >
                  <Icons.link size={13} />
                  Link to this trial
                </Link>
              </Button>
            </Box>
          ) : null}
        </Item>
      </Panel>
    </Grid>
  )
}
