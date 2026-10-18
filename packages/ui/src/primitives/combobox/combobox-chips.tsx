import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const chipsStyles = cva({
  base: {
    _dark: {
      "&:has([aria-invalid=true])": {
        borderColor: "brand.error.9/50",
        ringColor: "brand.error.4",
      },
      bg: "palette.gray.3/30",
    },

    _focusWithin: {
      borderColor: "border.focused",
      ring: "3px",
      ringColor: "brand.primary.3/50",
    },

    "&:has([aria-invalid=true])": {
      borderColor: "brand.error.9",
      ring: "3px",
      ringColor: "brand.error.3",
    },
    "&:has([data-slot=combobox-chip])": {
      px: "1",
    },

    alignItems: "center",
    bg: "transparent",
    bgClip: "padding-box",
    border: "subtle",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "2",
    gap: "1",
    minH: "2rem",
    px: "2.5",
    py: "1",
    rounded: "lg",
    transition: "colors",
  },
})

const StyledChips = styled(ComboboxPrimitive.Chips, chipsStyles)

export type ComboboxChipsProps = React.ComponentProps<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props &
  JsxStyleProps

export const ComboboxChips = ({ ...props }: ComboboxChipsProps) => {
  return <StyledChips data-slot="combobox-chips" {...props} />
}
