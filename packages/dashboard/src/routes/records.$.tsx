import type { RecordedExchange } from "@danwo/runner/runner"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { type ColumnDef, DataGrid } from "@danwo/ui/primitives/data-grid"
import { MarkdownDocument } from "@danwo/ui/primitives/markdown"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState, type ReactNode } from "react"

import { fetchRecord, fetchScreenshot } from "../api.ts"
import { duration, when } from "../components/format.ts"
import { Empty, PageTitle, StatusBadge } from "../components/status.tsx"
import type { RecordView, StepView } from "../data/records.ts"

export const Route = createFileRoute("/records/$")({
  loader: ({ params }) => fetchRecord({ data: params._splat ?? "" }),
  component: RecordPage,
})

/** A titled section of the record page. */
function Section({
  title,
  count,
  children,
}: {
  readonly title: string
  readonly count?: number
  readonly children: ReactNode
}) {
  return (
    <Stack as="section" gap="3" mt="8" aria-label={title}>
      <styled.h2 fontSize="2" fontWeight="semibold">
        {title}
        {count === undefined ? null : (
          <styled.span color="text.secondary" fontWeight="normal">
            {" "}
            ({count})
          </styled.span>
        )}
      </styled.h2>
      {children}
    </Stack>
  )
}

const Pre = styled("pre", {
  base: {
    fontFamily: "mono",
    fontSize: "0.5",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    bg: "background.muted",
    p: "3",
    rounded: "md",
    maxH: "24rem",
    overflowY: "auto",
  },
})

const stepColumns: ColumnDef<StepView>[] = [
  { header: "#", accessorKey: "index", size: 50 },
  { header: "Step", accessorKey: "label" },
  {
    header: "Status",
    accessorKey: "status",
    size: 110,
    cell: (c) => <StatusBadge status={c.row.original.status} />,
  },
  {
    header: "Cache",
    accessorKey: "cache",
    size: 120,
    cell: (c) => (c.row.original.cache ? <StatusBadge status={c.row.original.cache} /> : "–"),
  },
  {
    header: "Time",
    accessorKey: "durationMs",
    size: 90,
    cell: (c) => duration(c.row.original.durationMs),
  },
  { header: "Source", accessorKey: "source", size: 200, cell: (c) => c.row.original.source ?? "" },
]

/** The screenshot taken after a step, loaded when the step is picked. */
function Screenshot({ dir, file }: { readonly dir: string; readonly file: string }) {
  const [src, setSrc] = useState<string>()

  useEffect(() => {
    let live = true

    setSrc(undefined)
    void fetchScreenshot({ data: { dir, file } }).then((url) => {
      if (live) setSrc(url)
    })

    return () => {
      live = false
    }
  }, [dir, file])

  return src === undefined ? (
    <Box color="text.secondary" fontSize="1">
      Loading screenshot…
    </Box>
  ) : (
    <styled.img
      src={src}
      alt={`Screenshot after the step (${file})`}
      maxW="full"
      rounded="md"
      borderWidth="1px"
      borderColor="border.subtle"
    />
  )
}

function StepDetail({ dir, step }: { readonly dir: string; readonly step: StepView }) {
  return (
    <Stack
      gap="3"
      p="4"
      rounded="md"
      borderWidth="1px"
      borderColor="border.subtle"
      data-step={step.index}
    >
      <HStack gap="2" flexWrap="wrap">
        <styled.span fontWeight="medium">
          #{step.index} {step.label}
        </styled.span>
        <StatusBadge status={step.status} />
        {step.cache ? <StatusBadge status={step.cache} /> : null}
      </HStack>
      {step.cacheDetail ? (
        <Box color="text.secondary" fontSize="1">
          {step.cacheDetail}
        </Box>
      ) : null}
      {step.error ? <Pre>{step.error}</Pre> : null}
      {step.effects ? (
        <Stack gap="1">
          <HStack gap="2" fontSize="1">
            <span>Effects</span>
            {step.effectResult ? <StatusBadge status={step.effectResult} /> : null}
          </HStack>
          <Pre>{step.effects.join("\n")}</Pre>
        </Stack>
      ) : null}
      {step.screenshot ? <Screenshot dir={dir} file={step.screenshot} /> : null}
    </Stack>
  )
}

function Steps({ view }: { readonly view: RecordView }) {
  const failedStep = view.steps.find((s) => s.status !== "passed")
  const [picked, setPicked] = useState<StepView | undefined>(failedStep ?? view.steps.at(-1))

  if (view.steps.length === 0) return <Box color="text.secondary">This run recorded no steps.</Box>

  return (
    <Grid gridTemplateColumns={{ base: "1fr", lg: "3fr 2fr" }} gap="4" alignItems="start">
      <DataGrid
        data={view.steps}
        columns={stepColumns}
        getRowId={(s) => String(s.index)}
        onRowClick={setPicked}
        height="32rem"
      />
      {picked ? <StepDetail dir={view.dir} step={picked} /> : null}
    </Grid>
  )
}

function Exchange({ exchange }: { readonly exchange: RecordedExchange }) {
  return (
    <styled.details
      borderBottomWidth="1px"
      borderColor="border.subtle"
      py="2"
      data-exchange={exchange.id}
    >
      <styled.summary cursor="pointer" fontSize="1" display="flex" gap="2" alignItems="center">
        <styled.span fontFamily="mono">
          {exchange.method} {exchange.host}
          {exchange.path}
        </styled.span>
        <span>→ {exchange.aborted ? "aborted" : (exchange.status ?? "no answer")}</span>
        {exchange.fault ? <StatusBadge status="failed" /> : null}
        {exchange.fault ? <styled.span color="brand.error.11">{exchange.fault}</styled.span> : null}
      </styled.summary>
      <Grid gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="3" mt="2">
        <Stack gap="1">
          <Box fontSize="0.5" color="text.secondary">
            Request
          </Box>
          <Pre>{JSON.stringify(exchange.request ?? {}, null, 2)}</Pre>
        </Stack>
        <Stack gap="1">
          <Box fontSize="0.5" color="text.secondary">
            Response
          </Box>
          <Pre>{JSON.stringify(exchange.response ?? {}, null, 2)}</Pre>
        </Stack>
      </Grid>
    </styled.details>
  )
}

/** How the run is named in the title: its attempt, or the fault it ran under. */
function runName(view: RecordView): string {
  const { run } = view.record

  if (run.kind === "test") return `attempt ${run.attempt}`

  return run.fault ? run.fault.label : "clean run"
}

function RecordPage() {
  const view = Route.useLoaderData()

  if (view === null)
    return (
      <Empty
        title="No such record"
        hint="Records are pruned with their run; the latest 20 runs are kept."
      />
    )

  const { record } = view
  const logs = record.appLog.filter((log) => log.level === "error" || log.level === "warn")

  return (
    <>
      <PageTitle
        title={`${record.test} · ${runName(view)}`}
        detail={
          <HStack gap="2">
            <StatusBadge status={record.status} />
            <span>
              {when(record.startedAt)} · {duration(record.durationMs)}
            </span>
          </HStack>
        }
      />
      {record.error ? <Pre>{`${record.error.code}: ${record.error.message}`}</Pre> : null}
      {record.stopped ? (
        <Box mt="2" fontSize="1">
          Body stopped at {record.stopped}
        </Box>
      ) : null}
      {record.divergence ? (
        <Box mt="2" fontSize="1">
          Replay diverged at agent step {record.divergence.step + 1} (
          {record.divergence.instruction}): {record.divergence.reason}
        </Box>
      ) : null}
      {record.notes.map((note) => (
        <Box key={note} mt="1" fontSize="1" color="text.secondary">
          {note}
        </Box>
      ))}
      <Section title="Steps" count={view.steps.length}>
        <Steps view={view} />
      </Section>
      {view.screen ? (
        <Section title="Screen at failure">
          <Pre>{view.screen}</Pre>
        </Section>
      ) : null}
      <Section title="Console" count={logs.length}>
        {logs.length === 0 ? (
          <Box color="text.secondary" fontSize="1">
            No errors or warnings.
          </Box>
        ) : (
          <Pre>{logs.map((log) => `[${log.level}] step ${log.step}: ${log.text}`).join("\n")}</Pre>
        )}
      </Section>
      <Section title="Network" count={record.exchanges.length}>
        {record.exchanges.length === 0 ? (
          <Box color="text.secondary" fontSize="1">
            No calls went through the proxy.
          </Box>
        ) : (
          <Box>
            {record.exchanges.map((exchange) => (
              <Exchange key={exchange.id} exchange={exchange} />
            ))}
          </Box>
        )}
      </Section>
      <Section title="Webhooks" count={record.deliveries.length}>
        {record.deliveries.length === 0 ? (
          <Box color="text.secondary" fontSize="1">
            No webhook deliveries.
          </Box>
        ) : (
          <Pre>
            {record.deliveries
              .map(
                (d) =>
                  `${d.service ? `${d.service} ` : ""}${d.topic} attempt ${d.attempt} → ${d.status ?? d.error ?? "no answer"}${d.fault ? ` [fault: ${d.fault}]` : ""}`,
              )
              .join("\n")}
          </Pre>
        )}
      </Section>
      <Section title="Emulator state">
        <Pre>{view.state}</Pre>
      </Section>
      {view.page ? (
        <Section title="Failure page">
          <MarkdownDocument text={view.page} />
        </Section>
      ) : null}
    </>
  )
}
