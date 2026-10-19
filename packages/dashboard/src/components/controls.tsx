import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack } from "@danwo/ui/jsx"
import { Input } from "@danwo/ui/primitives/input"
import { Kbd } from "@danwo/ui/primitives/kbd"
import { Span } from "@danwo/ui/primitives/typography"
import type { RefObject } from "react"

/** The keys a list answers to. */
export function KeyHint({ filter = false }: { readonly filter?: boolean }) {
  return (
    <HStack gap="1" color="ink.muted" fontSize="1" display={{ base: "none", lg: "flex" }}>
      <Kbd>j</Kbd>
      <Kbd>k</Kbd>
      <Span>{filter ? "to move," : "to move"}</Span>
      {filter ? (
        <>
          <Kbd>/</Kbd>
          <Span>to filter</Span>
        </>
      ) : null}
    </HStack>
  )
}

/** A search box: the library's input with a magnifier inside it on the left. */
export function SearchBox({
  label,
  placeholder,
  value,
  onChange,
  inputRef,
  width = "16rem",
}: {
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly inputRef?: RefObject<HTMLInputElement | null>
  readonly width?: string
}) {
  return (
    <Box position="relative" w={{ base: "full", sm: width }}>
      <Box
        position="absolute"
        left="2.5"
        top="50%"
        transform="translateY(-50%)"
        color="ink.muted"
        pointerEvents="none"
        display="flex"
      >
        <Icons.searchNormal size={13} />
      </Box>
      <Input
        ref={inputRef}
        type="search"
        size="sm"
        pl="8"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Box>
  )
}

/** A list's key hints and its filter box. */
export function ListFilter({
  label,
  placeholder,
  filter,
}: {
  readonly label: string
  readonly placeholder: string
  readonly filter: {
    readonly query: string
    readonly setQuery: (query: string) => void
    readonly box: RefObject<HTMLInputElement | null>
  }
}) {
  return (
    <HStack gap="3">
      <KeyHint filter />
      <SearchBox
        label={label}
        placeholder={placeholder}
        value={filter.query}
        onChange={filter.setQuery}
        inputRef={filter.box}
      />
    </HStack>
  )
}
