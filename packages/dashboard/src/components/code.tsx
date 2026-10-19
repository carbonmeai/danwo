import { styled } from "@danwo/ui/jsx"

/** A short monospace span, for commands, codes and routes, on a faint fill. */
export const Code = styled("code", {
  base: {
    fontFamily: "mono",
    fontSize: "0.9em",
    bg: "surface.hover",
    px: "1",
    py: "0.5",
    rounded: "sm",
    overflowWrap: "anywhere",
  },
})

/** A machine name such as a route or fault label, in the mono face. */
export const Ident = styled("span", {
  base: { fontFamily: "mono", fontSize: "0.92em", overflowWrap: "anywhere" },
})

/** A block of preformatted text: a request body, an error, the console. */
export const Pre = styled("pre", {
  base: {
    fontFamily: "mono",
    fontSize: "1",
    lineHeight: "1.6",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    bg: "surface.panel",
    p: "3",
    rounded: "lg",
    maxH: "24rem",
    overflowY: "auto",
  },
})

/** A command to run, set apart so it reads as something to copy into a terminal. */
export function Command({ text }: { readonly text: string }) {
  return (
    <styled.code
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
      <styled.span color="ink.faint" userSelect="none" mr="1.5">
        $
      </styled.span>
      {text}
    </styled.code>
  )
}
