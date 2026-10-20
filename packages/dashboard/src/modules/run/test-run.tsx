import type { HistoryTest, TestHistory } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@danwo/ui/primitives/table"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { KeyHint } from "../../components/controls.tsx"
import { Page } from "../../components/page.tsx"
import { Panel, StatCard, StatCards } from "../../components/panel.tsx"
import { DeletedRecording, useRecordings } from "../../components/recordings.tsx"
import { StatusBadge, VerdictStrip } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { WhoseBadge } from "../../components/whose-badge.tsx"
import { dollars, duration } from "../../lib/format.ts"
import { useListKeys } from "../../lib/list-keys.ts"
import { testVerdict } from "../../lib/whose.ts"
import { RerunFailed, RerunTest } from "../live/run-actions.tsx"
import { cacheLine, sortedTests, testFigures } from "./run-values.ts"

/** Play buttons that open a test's kept recordings over the page, one per try that kept one. */
function WatchButtons({ test }: { readonly test: HistoryTest }) {
  const recordings = useRecordings()
  const kept = test.attempts.flatMap((attempt, i) =>
    attempt.record ? [{ i, dir: attempt.record }] : [],
  )

  if (kept.length > 0 && recordings?.pruned)
    return <DeletedRecording keepRuns={recordings.keepRuns} />

  if (kept.length === 0)
    return (
      <Span color="ink.faint" fontSize="1">
        not kept
      </Span>
    )

  return (
    <HStack gap="0.5">
      {kept.map(({ i, dir }) => {
        const label =
          kept.length === 1 && test.attempts.length === 1 ? "Watch" : `Watch try ${i + 1}`

        return (
          <Button
            key={dir}
            asChild
            variant="ghost"
            size={kept.length === 1 ? "icon" : "xs"}
            tooltipChildren={
              label === "Watch" ? "Watch the recording" : `Watch the recording of try ${i + 1}`
            }
          >
            <Link
              to="."
              search={(prev) => ({ ...prev, open: dir })}
              resetScroll={false}
              aria-label={label}
            >
              <Icons.play size={14} />
              {kept.length === 1 ? null : <Span>{i + 1}</Span>}
            </Link>
          </Button>
        )
      })}
    </HStack>
  )
}

/** The test files that did not load, on a red-tinted panel above the tests. */
function BrokenFiles({ run }: { readonly run: TestHistory }) {
  if (run.brokenFiles.length === 0) return null

  return (
    <Panel bg="verdict.failed.bg" gap="1.5" mb="2" aria-label="Files that did not load">
      <HStack gap="2" fontWeight="600" color="verdict.failed.fg">
        <Icons.warn size={14} />
        {run.brokenFiles.length} test {run.brokenFiles.length === 1 ? "file" : "files"} did not load
      </HStack>
      {run.brokenFiles.map((broken) => (
        <Span key={broken.file} color="ink.soft">
          <Ident>{broken.file}</Ident>: {broken.error}
        </Span>
      ))}
    </Panel>
  )
}

function TestLine({
  test,
  current,
  picked,
}: {
  readonly test: HistoryTest
  readonly current: boolean
  readonly picked: boolean
}) {
  const error = test.attempts.find((a) => a.error)?.error
  const verdict = testVerdict(test)
  const time = test.attempts.reduce((sum, a) => sum + a.durationMs, 0)
  const row = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    if (picked) row.current?.scrollIntoView({ block: "center" })
  }, [picked])

  return (
    <TableRow ref={row} data-row data-state={current || picked ? "selected" : undefined}>
      <TableCell px="3">
        <Stack gap="1" alignItems="flex-start">
          <StatusBadge status={test.status} />
          {verdict ? <WhoseBadge verdict={verdict} /> : null}
        </Stack>
      </TableCell>
      <TableCell whiteSpace="normal">
        <Stack gap="1">
          <Span fontWeight="500" overflowWrap="anywhere">
            {test.id}
          </Span>
          {error ? (
            <Span color="verdict.failed.fg" fontSize="1" lineClamp="2">
              <Ident>{error.code}</Ident> {error.message}
            </Span>
          ) : null}
          {test.attempts.length > 1 ? (
            <Span color="ink.muted" fontSize="1">
              {test.attempts.length - 1} {test.attempts.length === 2 ? "retry" : "retries"}
            </Span>
          ) : null}
        </Stack>
      </TableCell>
      <TableCell color="ink.muted" display={{ base: "none", lg: "table-cell" }}>
        {cacheLine(test.attempts.map((a) => a.usage))}
      </TableCell>
      <TableCell textAlign="right" fontVariantNumeric="tabular-nums">
        {duration(time)}
      </TableCell>
      <TableCell w="8rem">
        <HStack gap="0.5" justify="flex-end">
          <WatchButtons test={test} />
          <RerunTest testId={test.id} compact />
        </HStack>
      </TableCell>
    </TableRow>
  )
}

/** A `danwo test` run: its figures, any files that did not load, and every test, failures first. */
export function TestRun({
  run,
  crumbs,
  focus,
}: {
  readonly run: TestHistory
  readonly crumbs: ReactNode
  /** The test the page's address points at. */
  readonly focus?: string | undefined
}) {
  const tests = sortedTests(run)
  const figures = testFigures(run)
  const list = useRef<HTMLTableSectionElement>(null)
  const current = useListKeys(list, tests.length)

  return (
    <Page
      crumbs={[crumbs, figures.title]}
      title={figures.title}
      detail={
        <>
          <Ident>danwo test</Ident> run, started <TimeAgo at={run.startedAt} />
        </>
      }
      actions={
        <>
          <KeyHint />
          <RerunFailed runId={run.id} failed={figures.failed} />
        </>
      }
    >
      <StatCards>
        <StatCard
          label="Passed"
          icon={<Icons.checkCircle size={13} />}
          value={figures.passed}
          sub={<VerdictStrip shares={figures.shares} width="7rem" />}
        />
        <StatCard
          label="Failed"
          icon={<Icons.closeCircle size={13} />}
          value={figures.failed}
          sub={figures.failedNote}
        />
        <StatCard
          label="Time"
          icon={<Icons.clock size={13} />}
          value={duration(run.durationMs)}
          sub={figures.title}
        />
        <StatCard
          label="Model spend"
          icon={<Icons.dollar size={13} />}
          value={dollars(run.usage.spent.usd)}
          sub={figures.spend}
        />
      </StatCards>
      <BrokenFiles run={run} />
      <Panel px="2" py="1">
        <TableContainer aria-label="Tests in this run">
          <TableHeader>
            <TableRow _hover={{ bg: "transparent" }}>
              <TableHead w="8rem" px="3" color="ink.muted">
                Result
              </TableHead>
              <TableHead color="ink.muted">Test</TableHead>
              <TableHead color="ink.muted" display={{ base: "none", lg: "table-cell" }}>
                Replay cache
              </TableHead>
              <TableHead color="ink.muted" textAlign="right">
                Time
              </TableHead>
              <TableHead>
                <Span srOnly>Watch and run again</Span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={list}>
            {tests.map((test, i) => (
              <TestLine
                key={test.id}
                test={test}
                current={i === current}
                picked={test.id === focus}
              />
            ))}
          </TableBody>
        </TableContainer>
      </Panel>
    </Page>
  )
}
