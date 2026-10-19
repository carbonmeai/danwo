import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"

import { Ident } from "../../components/code.tsx"
import { Button } from "../../components/controls.tsx"
import { useCopied } from "../../components/copy-link.tsx"
import type { RecordView } from "./record-data.ts"
import { divergenceLine } from "./record-values.ts"

/** Copies the Markdown failure page, to paste into an issue or an agent's prompt. */
export function CopyPage({ text }: { readonly text: string }) {
  const [copied, copy] = useCopied()

  return (
    <Button type="button" onClick={() => copy(text)}>
      {copied ? <Icons.copyCheck size={14} /> : <Icons.copy size={14} />}
      <span aria-live="polite">{copied ? "Copied" : "Copy failure page"}</span>
    </Button>
  )
}

/** What went wrong in the run: the error, where the body stopped, a diverged replay, notes. */
export function Problem({ record }: { readonly record: RecordView["record"] }) {
  if (!record.error && !record.stopped && !record.divergence) return null

  const stopped =
    record.stopped && !record.notes.some((note) => note.includes(record.stopped ?? ""))
      ? record.stopped
      : undefined

  return (
    <Stack
      gap="1.5"
      bg="verdict.failed.bg"
      rounded="14px"
      px="4"
      py="3.5"
      mb="2"
      aria-label="What went wrong"
    >
      {record.error ? (
        <>
          <HStack gap="2" color="verdict.failed.fg" fontWeight="500">
            <Icons.warn size={14} />
            <Ident>{record.error.code}</Ident>
          </HStack>
          <styled.p fontSize="2" fontWeight="500" overflowWrap="anywhere">
            {record.error.message}
          </styled.p>
        </>
      ) : null}
      {[stopped, divergenceLine(record), ...record.notes].map((line) =>
        line ? (
          <Box key={line} color="ink.soft">
            {line}
          </Box>
        ) : null,
      )}
    </Stack>
  )
}
