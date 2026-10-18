import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { createFileRoute } from "@tanstack/react-router"
import { useDeferredValue, useRef, useState } from "react"

import { fetchImpact } from "../api.ts"
import { useListKeys } from "../components/keys.ts"
import {
  Code,
  Empty,
  FilterInput,
  Ident,
  KeyHint,
  PageTitle,
  Panel,
} from "../components/status.tsx"
import type { ImpactRow } from "../data/impact.ts"

export const Route = createFileRoute("/impact")({
  loader: () => fetchImpact(),
  component: ImpactPage,
})

const Tag = styled("span", {
  base: {
    fontFamily: "mono",
    fontSize: "1",
    px: "1.5",
    py: "0.5",
    rounded: "sm",
    whiteSpace: "nowrap",
    lineHeight: "1.4",
  },
  variants: {
    kind: {
      provider: { bg: "signal.accentSoft", color: "signal.accent", fontWeight: "500" },
      route: {
        bg: "signal.raised",
        color: "signal.ink",
        borderWidth: "1px",
        borderColor: "signal.rule",
      },
      webhook: { color: "signal.accent", borderWidth: "1px", borderColor: "signal.accent" },
    },
  },
})

function Tags({
  items,
  kind,
}: {
  readonly items: readonly string[]
  readonly kind: "provider" | "route" | "webhook"
}) {
  if (items.length === 0) return <styled.span color="signal.faint">–</styled.span>

  return (
    <HStack gap="1.5" flexWrap="wrap">
      {items.map((item) => (
        <Tag key={item} kind={kind}>
          {item}
        </Tag>
      ))}
    </HStack>
  )
}

function matches(row: ImpactRow, query: string): boolean {
  const haystack = [row.test, ...row.providers, ...row.routes, ...row.webhooks, ...row.calls]
    .join(" ")
    .toLowerCase()

  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word))
}

const Label = styled("div", { base: { color: "signal.quiet", fontSize: "1", mb: "1" } })

function ImpactPage() {
  const rows = Route.useLoaderData()
  const [query, setQuery] = useState("")
  const deferred = useDeferredValue(query.trim())
  const list = useRef<HTMLUListElement>(null)
  const filter = useRef<HTMLInputElement>(null)
  const shown = deferred === "" ? rows : rows.filter((row) => matches(row, deferred))
  const current = useListKeys(list, shown.length, filter)

  if (rows.length === 0)
    return (
      <Empty
        title="No impact index yet"
        hint={
          <>
            Every passing test adds what it touched behind the app to{" "}
            <Code>.danwo/impact.json</Code>: the providers, routes and webhooks. Then{" "}
            <Code>danwo test --changed</Code> runs only the tests a change can reach.
          </>
        }
        command="danwo test"
      />
    )

  return (
    <>
      <PageTitle
        title="Impact"
        detail={
          <>
            What each test touches behind the app. <Code>danwo test --changed</Code> picks tests
            from it.
          </>
        }
        actions={
          <HStack gap="3">
            <KeyHint />
            <FilterInput
              ref={filter}
              type="search"
              placeholder="Filter by test, provider or route"
              aria-label="Filter tests"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </HStack>
        }
      />
      <Panel overflow="hidden">
        <styled.ul ref={list} aria-label="Tests">
          {shown.map((row, i) => (
            <Grid
              as="li"
              key={row.test}
              data-row
              data-current={i === current || undefined}
              gridTemplateColumns={{
                base: "1fr",
                lg: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
              }}
              gap="4"
              px="5"
              py="4"
              borderBottomWidth="1px"
              borderColor="signal.rule"
              _last={{ borderBottomWidth: "0" }}
              css={{ "&[data-current]": { bg: "signal.accentSoft" } }}
            >
              <Stack gap="1" minW="0">
                <styled.span fontWeight="500" overflowWrap="anywhere">
                  {row.test}
                </styled.span>
                {row.calls.length > 0 ? (
                  <styled.details fontSize="1" color="signal.quiet">
                    <styled.summary cursor="pointer" w="fit-content">
                      {row.calls.length} provider {row.calls.length === 1 ? "call" : "calls"}
                    </styled.summary>
                    <Stack gap="0.5" mt="1">
                      {row.calls.map((call) => (
                        <Ident key={call}>{call}</Ident>
                      ))}
                    </Stack>
                  </styled.details>
                ) : null}
              </Stack>
              <Box>
                <Label>Providers</Label>
                <Tags items={row.providers} kind="provider" />
              </Box>
              <Box>
                <Label>App routes</Label>
                <Tags items={row.routes} kind="route" />
              </Box>
              <Box>
                <Label>Webhooks</Label>
                <Tags items={row.webhooks} kind="webhook" />
              </Box>
            </Grid>
          ))}
        </styled.ul>
        {shown.length === 0 ? (
          <Box p="6" color="signal.quiet" textAlign="center">
            No test matches “{deferred}”.
          </Box>
        ) : null}
      </Panel>
    </>
  )
}
