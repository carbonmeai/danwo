import type { RecordedExchange } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { TableBody, TableCell, TableHead, TableRow } from "@danwo/ui/primitives/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@danwo/ui/primitives/tooltip"
import { Span, Text } from "@danwo/ui/primitives/typography"

import { Ident, Pre } from "../../components/code.tsx"
import { ScrollTable } from "../../components/scroll-table.tsx"
import { duration } from "../../lib/format.ts"
import type { RecordView } from "./record-data.ts"
import { bodyText, statusColor } from "./record-values.ts"

/** An HTTP status or outcome in its colour, in the mono face. */
function Outcome({ outcome, bad }: { readonly outcome: string; readonly bad: boolean }) {
  return (
    <Span fontWeight="600" fontSize="1" fontFamily="mono" color={statusColor({ outcome, bad })}>
      {outcome}
    </Span>
  )
}

/** What a call ended as: its status, or why it has none. */
function outcomeOf(exchange: RecordedExchange): string {
  return exchange.aborted ? "aborted" : String(exchange.status ?? "no answer")
}

/** A long path cut to the cell, the whole URL in a tooltip. */
function PathCell({ exchange }: { readonly exchange: RecordedExchange }) {
  const url = `${exchange.host}${exchange.path}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Ident
          display="block"
          fontSize="1"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          maxW="28rem"
        >
          {exchange.path}
        </Ident>
      </TooltipTrigger>
      <TooltipContent maxW="32rem" overflowWrap="anywhere">
        {exchange.method} https://{url}
      </TooltipContent>
    </Tooltip>
  )
}

/** The calls as the library's table, a picked one marked; picking one shows it beside. */
export function CallsTable({
  exchanges,
  picked,
  onPick,
}: {
  readonly exchanges: readonly RecordedExchange[]
  readonly picked: string | undefined
  readonly onPick: (id: string | undefined) => void
}) {
  return (
    <ScrollTable
      label="Calls"
      head={
        <TableRow _hover={{ bg: "transparent" }}>
          {["Status", "Method", "Host", "Path", "Took"].map((head) => (
            <TableHead
              key={head}
              color="ink.muted"
              px="3"
              textAlign={head === "Took" ? "right" : "left"}
            >
              {head}
            </TableHead>
          ))}
        </TableRow>
      }
    >
      <TableBody>
        {exchanges.map((exchange) => (
          <TableRow
            key={exchange.id}
            data-exchange={exchange.id}
            data-state={exchange.id === picked ? "selected" : undefined}
            cursor="pointer"
            tabIndex={0}
            aria-selected={exchange.id === picked}
            onClick={() => onPick(exchange.id === picked ? undefined : exchange.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onPick(exchange.id === picked ? undefined : exchange.id)
              }
            }}
          >
            <TableCell px="3" w="6rem">
              <HStack gap="1.5">
                <Outcome
                  outcome={outcomeOf(exchange)}
                  bad={exchange.aborted || (exchange.status ?? 500) >= 400}
                />
                {exchange.fault ? (
                  <Icons.zap
                    size={12}
                    color="verdict.failed.fg"
                    aria-label={`fault: ${exchange.fault}`}
                  />
                ) : null}
              </HStack>
            </TableCell>
            <TableCell px="3" w="5rem" fontFamily="mono" fontSize="1">
              {exchange.method}
            </TableCell>
            <TableCell px="3" fontFamily="mono" fontSize="1" color="ink.soft">
              {exchange.host}
            </TableCell>
            <TableCell px="3" maxW="28rem">
              <PathCell exchange={exchange} />
            </TableCell>
            <TableCell px="3" w="5rem" textAlign="right" color="ink.muted" fontSize="1">
              {exchange.durationMs === null || exchange.durationMs === undefined
                ? "–"
                : duration(exchange.durationMs)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </ScrollTable>
  )
}

/** A captured request or response: its headers, then its body, already redacted. */
function Message({
  title,
  message,
}: {
  readonly title: string
  readonly message: RecordedExchange["request"]
}) {
  return (
    <Stack gap="1.5" minW="0">
      <Text fontSize="1" fontWeight="600" color="ink.soft">
        {title}
      </Text>
      {message === undefined ? (
        <Text fontSize="1" color="ink.muted">
          Not captured.
        </Text>
      ) : (
        <>
          <Pre bg="surface.panel" maxH="12rem">
            {Object.entries(message.headers)
              .map(([name, value]) => `${name}: ${value}`)
              .join("\n") || "(no headers)"}
          </Pre>
          <Pre bg="surface.panel" maxH="20rem">
            {bodyText(message)}
          </Pre>
        </>
      )}
    </Stack>
  )
}

/** One call in full beside the table: what was asked and what came back, and the fault. */
export function CallDetail({
  exchange,
  onClose,
}: {
  readonly exchange: RecordedExchange
  readonly onClose: () => void
}) {
  return (
    <Stack
      gap="3"
      h="full"
      minH="0"
      bg="surface.item"
      rounded="10px"
      p="3"
      overflowY="auto"
      aria-label="Call"
    >
      <HStack justify="space-between" gap="2" alignItems="flex-start">
        <Stack gap="1" minW="0">
          <HStack gap="2">
            <Outcome
              outcome={outcomeOf(exchange)}
              bad={exchange.aborted || (exchange.status ?? 500) >= 400}
            />
            <Ident fontSize="1" fontWeight="500">
              {exchange.method}
            </Ident>
          </HStack>
          <Ident fontSize="1" color="ink.soft">
            {exchange.host}
            {exchange.path}
          </Ident>
          {exchange.fault ? (
            <Span fontSize="1" color="verdict.failed.fg" fontWeight="500">
              fault: {exchange.fault}
            </Span>
          ) : null}
        </Stack>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close the call"
          tooltipChildren="Close"
          onClick={onClose}
        >
          <Icons.close size={14} />
        </Button>
      </HStack>
      <Grid gridTemplateColumns="1fr" gap="3">
        <Message title="Request" message={exchange.request} />
        <Message title="Response" message={exchange.response} />
      </Grid>
    </Stack>
  )
}

/** Every webhook delivery as the library's table: its outcome, the topic and its fault. */
export function DeliveriesTable({
  deliveries,
}: {
  readonly deliveries: RecordView["record"]["deliveries"]
}) {
  return (
    <ScrollTable
      label="Deliveries"
      head={
        <TableRow _hover={{ bg: "transparent" }}>
          {["Status", "Topic", "Attempt", "Fault"].map((head) => (
            <TableHead key={head} color="ink.muted" px="3">
              {head}
            </TableHead>
          ))}
        </TableRow>
      }
    >
      <TableBody>
        {deliveries.map((d, i) => (
          <TableRow key={`${d.topic}-${i}`}>
            <TableCell px="3" w="6rem">
              <Outcome
                outcome={d.status === null ? (d.error ?? "no answer") : String(d.status)}
                bad={d.status === null || d.status >= 400}
              />
            </TableCell>
            <TableCell px="3">
              <Ident fontSize="1">
                {d.service ? `${d.service} ` : ""}
                {d.topic}
              </Ident>
            </TableCell>
            <TableCell px="3" w="5rem" color="ink.muted" fontSize="1">
              {d.attempt}
            </TableCell>
            <TableCell px="3">
              {d.fault ? (
                <Span fontSize="1" color="verdict.failed.fg" fontWeight="500">
                  {d.fault}
                </Span>
              ) : (
                <Span color="ink.faint">–</Span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </ScrollTable>
  )
}

/** Nothing in a list, said plainly inside its region. */
export function NoneHere({ children }: { readonly children: string }) {
  return (
    <Box h="full" display="grid" placeItems="center" color="ink.muted" fontSize="1.5">
      {children}
    </Box>
  )
}
