import { Code as LibraryCode, Pre as LibraryPre, Span } from "@danwo/ui/primitives/typography"
import type { CodeProps, PreProps, SpanProps } from "@danwo/ui/primitives/typography/typography"

/** A short monospace span, for commands, codes and routes, on a faint fill. */
export function Code(props: CodeProps) {
  return (
    <LibraryCode
      fontFamily="mono"
      fontSize="0.9em"
      bg="surface.hover"
      px="1"
      py="0.5"
      rounded="sm"
      overflowWrap="anywhere"
      {...props}
    />
  )
}

/** A machine name such as a route or fault label, in the mono face. */
export function Ident(props: SpanProps) {
  return <Span fontFamily="mono" fontSize="0.92em" overflowWrap="anywhere" {...props} />
}

/** A block of preformatted text: a request body, an error, the console. */
export function Pre(props: PreProps) {
  return (
    <LibraryPre
      fontFamily="mono"
      fontSize="1"
      lineHeight="1.6"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      bg="surface.panel"
      p="3"
      rounded="lg"
      maxH="24rem"
      overflowY="auto"
      {...props}
    />
  )
}

/** A command to run, set apart so it reads as something to copy into a terminal. */
export function Command({ text }: { readonly text: string }) {
  return (
    <LibraryCode
      display="inline-flex"
      alignItems="center"
      h="7"
      fontFamily="mono"
      fontSize="1"
      px="2.5"
      rounded="lg"
      bg="surface.hover"
      color="ink.strong"
      whiteSpace="nowrap"
    >
      <Span color="ink.faint" userSelect="none" mr="1.5">
        $
      </Span>
      {text}
    </LibraryCode>
  )
}
