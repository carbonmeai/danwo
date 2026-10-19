import { useIsMobile } from "@danwo/ui/hooks/use-mobile"
import { Box, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Dialog, DialogContent, DialogTitle } from "@danwo/ui/primitives/dialog"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@danwo/ui/primitives/resizable"
import { TabContent, TabTrigger, Tabs, TabsList } from "@danwo/ui/primitives/tabs"
import { Text } from "@danwo/ui/primitives/typography"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"

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

/**
 * The right pane: the library's tabs, the one open kept in the address, and its body filling what
 * is left so each pane scrolls inside itself.
 */
function EvidencePane({
  view,
  pane,
  playback,
}: {
  readonly view: RecordView
  readonly pane: Pane
  readonly playback: PaneProps["playback"]
}) {
  const navigate = useNavigate()
  const shown = PANES.filter((each) => each !== "matrix" || view.record.run.kind === "matrix")
  const Body = PANE_BODY[pane]

  return (
    <Tabs
      value={pane}
      onValueChange={(next) =>
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            pane: next === "replay" || !isPane(next) ? undefined : next,
          }),
          replace: true,
          resetScroll: false,
        })
      }
      display="flex"
      flexDirection="column"
      h="full"
      minH="0"
      p="5"
      pr="12"
      gap="4"
    >
      <Box overflowX="auto" flexShrink="0">
        <TabsList aria-label="What to look at">
          {shown.map((each) => (
            <TabTrigger key={each} value={each}>
              {PANE_WORDS[each]}
            </TabTrigger>
          ))}
        </TabsList>
      </Box>
      <TabContent value={pane} flex="1" minH="0">
        <Body view={view} playback={playback} />
      </TabContent>
    </Tabs>
  )
}

/** The two panes over one playback: the transcript on the left, the run's evidence on the right. */
function Panes({ view, pane }: { readonly view: RecordView; readonly pane: Pane }) {
  const playback = usePlayback(view.replay)
  const playable = view.replay.videos.length > 0 || view.replay.frames.length > 0
  const shared = playable ? playback : undefined
  const phone = useIsMobile()

  if (phone)
    return (
      <Stack gap="0" h="full" minH="0" overflowY="auto">
        <Box flexShrink="0" maxH="50dvh" overflow="hidden" bg="surface.sidebar">
          <Transcript view={view} playback={shared} />
        </Box>
        <Box flex="1" minH="32rem">
          <EvidencePane view={view} pane={pane} playback={shared} />
        </Box>
      </Stack>
    )

  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId="danwo-overlay">
      <ResizablePanel defaultSize="28" minSize="18" maxSize="45">
        <Box h="full" minH="0" bg="surface.sidebar" overflow="hidden">
          <Transcript view={view} playback={shared} />
        </Box>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="72" minSize="40">
        <EvidencePane view={view} pane={pane} playback={shared} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/**
 * One run of a test, opened over whatever page linked to it (`?open=<record folder>`) in the
 * library's dialog: its steps on the left with jumps into the replay, and on the right the replay,
 * console, network, provider calls, emulator state, effects and, for a matrix trial, its fault.
 * Esc or the close button goes back to the page beneath.
 */
export function RecordOverlay() {
  const { open, pane } = useTarget()
  const view = useRecord(open)
  const navigate = useNavigate()

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
    <Dialog open={open !== undefined} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        w="calc(100vw - 2rem)"
        maxW="1680px"
        h={{ base: "100dvh", md: "calc(100dvh - 2rem)" }}
        p="0"
        gap="0"
        rounded={{ base: "0", md: "16px" }}
        bg="surface.page"
        display="flex"
        flexDirection="column"
      >
        {view === undefined ? (
          <>
            <DialogTitle srOnly>Loading the recording</DialogTitle>
            <Box p="8" color="ink.muted">
              Loading the recording…
            </Box>
          </>
        ) : view === null ? (
          <Stack p="8" gap="3">
            <DialogTitle fontWeight="600">No such recording</DialogTitle>
            <Text color="ink.muted">
              Recordings are pruned with their run; the latest 20 runs keep theirs.
            </Text>
            <Box>
              <Button variant="soft" size="sm" onClick={onClose}>
                Close
              </Button>
            </Box>
          </Stack>
        ) : (
          <Box flex="1" minH="0">
            <Panes key={view.dir} view={view} pane={pane} />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
