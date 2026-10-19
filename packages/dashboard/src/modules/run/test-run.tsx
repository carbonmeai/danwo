import type { HistoryTest, TestHistory } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { KeyHint } from "../../components/controls.tsx"
import { Page } from "../../components/page.tsx"
import { StatCard, StatCards } from "../../components/panel.tsx"
import { StatusBadge, VerdictStrip } from "../../components/status-badge.tsx"
import { RowPanel, RowTable, Td, Th } from "../../components/table.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { dollars, duration } from "../../lib/format.ts"
import { useListKeys } from "../../lib/list-keys.ts"
import { RerunFailed, RerunTest } from "../live/run-actions.tsx"
import { cacheLine, sortedTests, testFigures } from "./run-values.ts"

/** Links to a test's kept flight records, one per attempt that kept one. */
function AttemptLinks({ test }: { readonly test: HistoryTest }) {
  const kept = test.attempts.flatMap((attempt, i) =>
    attempt.record ? [{ i, dir: attempt.record }] : [],
  )

  if (kept.length === 0) return <styled.span color="ink.faint">–</styled.span>

  return (
    <HStack gap="3">
      {kept.map(({ i, dir }) => (
        <Link key={dir} to="/records/$" params={{ _splat: dir }} data-link>
          attempt {i + 1}
        </Link>
      ))}
    </HStack>
  )
}

/** The test files that did not load, on a red-tinted panel above the tests. */
function BrokenFiles({ run }: { readonly run: TestHistory }) {
  if (run.brokenFiles.length === 0) return null

  return (
    <Stack
      gap="1.5"
      bg="verdict.failed.bg"
      rounded="14px"
      px="4"
      py="3.5"
      mb="2"
      aria-label="Files that did not load"
    >
      <HStack gap="2" fontWeight="600" color="verdict.failed.fg">
        <Icons.warn size={14} />
        {run.brokenFiles.length} test {run.brokenFiles.length === 1 ? "file" : "files"} did not load
      </HStack>
      {run.brokenFiles.map((broken) => (
        <styled.span key={broken.file} color="ink.soft">
          <Ident>{broken.file}</Ident>: {broken.error}
        </styled.span>
      ))}
    </Stack>
  )
}

function TestLine({
  runId,
  test,
  current,
  picked,
}: {
  readonly runId: string
  readonly test: HistoryTest
  readonly current: boolean
  readonly picked: boolean
}) {
  const error = test.attempts.find((a) => a.error)?.error
  const time = test.attempts.reduce((sum, a) => sum + a.durationMs, 0)
  const row = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    if (picked) row.current?.scrollIntoView({ block: "center" })
  }, [picked])

  return (
    <tr ref={row} data-row data-current={current || undefined} data-picked={picked || undefined}>
      <Td>
        <StatusBadge status={test.status} />
      </Td>
      <Td>
        <Stack gap="1">
          <Link
            to="/runs/$runId"
            params={{ runId }}
            search={{ test: test.id }}
            replace
            title="A link to this test in this run"
          >
            <styled.span fontWeight="500" overflowWrap="anywhere">
              {test.id}
            </styled.span>
          </Link>
          {error ? (
            <styled.span color="verdict.failed.fg" fontSize="1" lineClamp="2">
              <Ident>{error.code}</Ident> {error.message}
            </styled.span>
          ) : null}
          {test.attempts.length > 1 ? (
            <styled.span color="ink.muted" fontSize="1">
              {test.attempts.length} attempts
            </styled.span>
          ) : null}
        </Stack>
      </Td>
      <Td color="ink.muted" display={{ base: "none", lg: "table-cell" }}>
        {cacheLine(test.attempts.map((a) => a.usage))}
      </Td>
      <Td textAlign="right" fontVariantNumeric="tabular-nums" whiteSpace="nowrap">
        {duration(time)}
      </Td>
      <Td>
        <AttemptLinks test={test} />
      </Td>
      <Td w="6rem">
        <RerunTest testId={test.id} />
      </Td>
    </tr>
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
          sub={figures.flaky > 0 ? `${figures.flaky} flaky` : "none flaky"}
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
      <RowPanel overflowX="auto">
        <RowTable>
          <thead>
            <tr>
              <Th w="8rem">Result</Th>
              <Th>Test</Th>
              <Th display={{ base: "none", lg: "table-cell" }}>Replay cache</Th>
              <Th textAlign="right">Time</Th>
              <Th>Flight records</Th>
              <Th>
                <styled.span srOnly>Run again</styled.span>
              </Th>
            </tr>
          </thead>
          <tbody ref={list}>
            {tests.map((test, i) => (
              <TestLine
                key={test.id}
                runId={run.id}
                test={test}
                current={i === current}
                picked={test.id === focus}
              />
            ))}
          </tbody>
        </RowTable>
      </RowPanel>
    </Page>
  )
}
