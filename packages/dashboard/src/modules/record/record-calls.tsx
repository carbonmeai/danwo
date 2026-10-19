import type { RecordedExchange } from "@danwo/runner/runner"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { useState } from "react"

import { Ident, Pre } from "../../components/code.tsx"
import { Row, RowList } from "../../components/table.tsx"
import { duration } from "../../lib/format.ts"
import type { RecordView } from "./record-data.ts"
import { LEVEL_COLOR, statusColor } from "./record-values.ts"

/** An HTTP status or outcome in its colour, in the mono face. */
function Outcome({ outcome, bad }: { readonly outcome: string; readonly bad: boolean }) {
  return (
    <styled.span
      fontWeight="600"
      fontSize="1"
      fontFamily="mono"
      color={statusColor({ outcome, bad })}
    >
      {outcome}
    </styled.span>
  )
}

function Exchange({ exchange }: { readonly exchange: RecordedExchange }) {
  const outcome = exchange.aborted ? "aborted" : String(exchange.status ?? "no answer")

  return (
    <Row p="0" data-exchange={exchange.id}>
      <styled.details>
        <styled.summary
          cursor="pointer"
          display="grid"
          gridTemplateColumns="4rem minmax(0, 1fr) auto"
          gap="3"
          alignItems="center"
          px="3"
          py="2.5"
        >
          <Outcome outcome={outcome} bad={exchange.aborted || (exchange.status ?? 500) >= 400} />
          <Ident fontSize="1" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
            {exchange.method} {exchange.host}
            {exchange.path}
          </Ident>
          <HStack gap="2" justify="flex-end">
            {exchange.fault ? (
              <styled.span fontSize="1" color="verdict.failed.fg" fontWeight="500">
                fault: {exchange.fault}
              </styled.span>
            ) : null}
            {exchange.durationMs === undefined || exchange.durationMs === null ? null : (
              <styled.span color="ink.muted" fontSize="1">
                {duration(exchange.durationMs)}
              </styled.span>
            )}
          </HStack>
        </styled.summary>
        <Grid gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="2" px="3" pb="3">
          <Stack gap="1">
            <Box fontSize="1" color="ink.muted">
              Request
            </Box>
            <Pre>{JSON.stringify(exchange.request ?? {}, null, 2)}</Pre>
          </Stack>
          <Stack gap="1">
            <Box fontSize="1" color="ink.muted">
              Response
            </Box>
            <Pre>{JSON.stringify(exchange.response ?? {}, null, 2)}</Pre>
          </Stack>
        </Grid>
      </styled.details>
    </Row>
  )
}

const FIRST_CALLS = 12

/** The calls, faulted and failed ones first, the rest folded away past the first few. */
export function Calls({ exchanges }: { readonly exchanges: readonly RecordedExchange[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? exchanges : exchanges.slice(0, FIRST_CALLS)

  return (
    <Stack gap="3px">
      <RowList aria-label="Calls">
        {shown.map((exchange) => (
          <Exchange key={exchange.id} exchange={exchange} />
        ))}
      </RowList>
      {exchanges.length > FIRST_CALLS ? (
        <styled.button
          type="button"
          h="8"
          rounded="lg"
          color="ink.soft"
          fontWeight="500"
          cursor="pointer"
          _hover={{ bg: "surface.hover", color: "ink.strong" }}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${exchanges.length} calls`}
        </styled.button>
      ) : null}
    </Stack>
  )
}

/** Every webhook delivery: its outcome, the topic, and the fault it ran under. */
export function Deliveries({
  deliveries,
}: {
  readonly deliveries: RecordView["record"]["deliveries"]
}) {
  return (
    <RowList aria-label="Deliveries">
      {deliveries.map((d, i) => (
        <Row
          key={`${d.topic}-${i}`}
          display="grid"
          gridTemplateColumns="4rem minmax(0, 1fr) auto"
          gap="3"
          alignItems="center"
          minH="10"
        >
          <Outcome
            outcome={d.status === null ? (d.error ?? "no answer") : String(d.status)}
            bad={d.status === null || d.status >= 400}
          />
          <Ident fontSize="1">
            {d.service ? `${d.service} ` : ""}
            {d.topic}
            {d.attempt > 1 ? `, attempt ${d.attempt}` : ""}
          </Ident>
          {d.fault ? (
            <styled.span fontSize="1" color="verdict.failed.fg" fontWeight="500">
              fault: {d.fault}
            </styled.span>
          ) : (
            <span />
          )}
        </Row>
      ))}
    </RowList>
  )
}

/** The app's console errors and warnings, by the step they came in. */
export function ConsoleLog({ logs }: { readonly logs: RecordView["record"]["appLog"] }) {
  return (
    <Pre bg="surface.item">
      {logs.map((log, i) => (
        <styled.span key={i} display="block" color={LEVEL_COLOR[log.level]}>
          {`step ${log.step}  ${log.level.padEnd(5)}  ${log.text}`}
        </styled.span>
      ))}
    </Pre>
  )
}
