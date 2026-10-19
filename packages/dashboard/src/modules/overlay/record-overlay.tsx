import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"

import { Button, SegmentTrack, segment } from "../../components/controls.tsx"
import { fetchRecord } from "../record/record-api.ts"
import type { RecordView } from "../record/record-data.ts"
import { usePlayback } from "../record/use-playback.ts"
import {
  ConsolePane,
  EffectsPane,
  MatrixPane,
  NetworkPane,
  PANES,
  PANE_WORDS,
  type Pane,
  type PaneProps,
  ProvidersPane,
  ReplayPane,
  StatePane,
} from "./overlay-panes.tsx"
import { Transcript } from "./overlay-transcript.tsx"

const PANE_BODY: Readonly<Record<Pane, (props: PaneProps) => ReactNode>> = {
  replay: ReplayPane,
  console: ConsolePane,
  network: NetworkPane,
  providers: ProvidersPane,
  state: StatePane,
  effects: EffectsPane,
  matrix: MatrixPane,
}

export function isPane(value: unknown): value is Pane {
  return typeof value === "string" && (PANES as readonly string[]).includes(value)
}

/** What the address asks the overlay to show: a record folder, and which pane. */
function useTarget(): { readonly open?: string; readonly pane: Pane } {
  return useRouterState({
    select: (state) => {
      const search: Record<string, unknown> = state.location.search
      const open = typeof search.open === "string" && search.open !== "" ? search.open : undefined

      return {
        ...(open !== undefined && { open }),
        pane: isPane(search.pane) ? search.pane : "replay",
      }
    },
    structuralSharing: true,
  })
}

/** The record in `dir`, loaded once it is asked for; null when there is none. */
function useRecord(dir: string | undefined): RecordView | null | undefined {
  const [loaded, setLoaded] = useState<{ dir: string; view: RecordView | null }>()

  useEffect(() => {
    if (dir === undefined) return undefined

    let live = true

    void fetchRecord({ data: dir })
      .catch(() => null)
      .then((view) => {
        if (live) setLoaded({ dir, view })
      })

    return () => {
      live = false
    }
  }, [dir])

  if (loaded === undefined || loaded.dir !== dir) return undefined

  return loaded.view
}

/** The right pane's tabs, kept in the address. */
function PaneTabs({ pane, matrix }: { readonly pane: Pane; readonly matrix: boolean }) {
  const navigate = useNavigate()

  return (
    <Box overflowX="auto" maxW="full">
      <SegmentTrack role="tablist" aria-label="What to look at">
        {PANES.filter((each) => each !== "matrix" || matrix).map((each) => (
          <styled.button
            key={each}
            type="button"
            className={segment}
            role="tab"
            aria-selected={each === pane}
            data-on={each === pane || undefined}
            onClick={() =>
              void navigate({
                to: ".",
                search: (prev: Record<string, unknown>) => ({
                  ...prev,
                  pane: each === "replay" ? undefined : each,
                }),
                replace: true,
                resetScroll: false,
              })
            }
          >
            {PANE_WORDS[each]}
          </styled.button>
        ))}
      </SegmentTrack>
    </Box>
  )
}

/** The two panes over one playback: the transcript on the left, the run's evidence on the right. */
function Panes({
  view,
  pane,
  onClose,
}: {
  readonly view: RecordView
  readonly pane: Pane
  readonly onClose: () => void
}) {
  const playback = usePlayback(view.replay)
  const playable = view.replay.videos.length > 0 || view.replay.frames.length > 0
  const shared = playable ? playback : undefined
  const Body = PANE_BODY[pane]

  return (
    <Grid
      gridTemplateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(20rem, 26rem) minmax(0, 1fr)" }}
      gridTemplateRows={{ base: "auto minmax(0, 1fr)", lg: "minmax(0, 1fr)" }}
      h="full"
      minH="0"
      gap="0"
    >
      <Box minH="0" bg="surface.sidebar" overflow="hidden" display={{ base: "none", lg: "block" }}>
        <Transcript view={view} playback={shared} />
      </Box>
      <Stack gap="4" p="5" minH="0" overflowY="auto">
        <HStack justify="space-between" gap="3" flexWrap="wrap">
          <PaneTabs pane={pane} matrix={view.record.run.kind === "matrix"} />
          <Button type="button" look="ghost" w="8" px="0" aria-label="Close" onClick={onClose}>
            <Icons.close size={16} />
          </Button>
        </HStack>
        <Box display={{ base: "block", lg: "none" }}>
          <Transcript view={view} playback={shared} />
        </Box>
        <Body view={view} playback={shared} />
      </Stack>
    </Grid>
  )
}

/**
 * One run of a test, opened over whatever page linked to it (`?open=<record folder>`): its steps
 * on the left with jumps into the replay, and on the right the replay, console, network, provider
 * calls, emulator state, effects and, for a matrix trial, its fault. Esc or the close button goes
 * back to the page beneath.
 */
export function RecordOverlay() {
  const { open, pane } = useTarget()
  const view = useRecord(open)
  const navigate = useNavigate()

  useEffect(() => {
    if (open === undefined) return undefined

    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            open: undefined,
            pane: undefined,
            t: undefined,
          }),
          resetScroll: false,
        })
    }

    window.addEventListener("keydown", close)

    return () => window.removeEventListener("keydown", close)
  }, [open, navigate])

  if (open === undefined) return null

  const onClose = () =>
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        open: undefined,
        pane: undefined,
        t: undefined,
      }),
      resetScroll: false,
    })

  return (
    <Box
      position="fixed"
      inset="0"
      zIndex="30"
      bg="rgba(10, 18, 23, 0.36)"
      display="grid"
      placeItems="center"
      p={{ base: "0", md: "4" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <Box
        role="dialog"
        aria-modal="true"
        aria-labelledby="overlay-title"
        w="full"
        maxW="1680px"
        h={{ base: "100dvh", md: "calc(100dvh - 2rem)" }}
        bg="surface.page"
        rounded={{ base: "0", md: "16px" }}
        boxShadow="pop"
        overflow="hidden"
      >
        {view === undefined ? (
          <Box p="8" color="ink.muted">
            Loading the recording…
          </Box>
        ) : view === null ? (
          <Stack p="8" gap="3">
            <styled.h2 id="overlay-title" fontWeight="600">
              No such recording
            </styled.h2>
            <styled.p color="ink.muted">
              Recordings are pruned with their run; the latest 20 runs keep theirs.
            </styled.p>
            <Box>
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            </Box>
          </Stack>
        ) : (
          <Panes key={view.dir} view={view} pane={pane} onClose={onClose} />
        )}
      </Box>
    </Box>
  )
}
