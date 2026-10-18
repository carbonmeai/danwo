import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { Icons } from "../../icons/base"
import { Button } from "../button/button"

const chipStyles = cva({
  base: {
    "&:has([data-slot=combobox-chip-remove])": {
      pr: "0",
    },

    "&:has([disabled])": {
      cursor: "not-allowed",
      opacity: "0.5",
      pointerEvents: "none",
    },

    alignItems: "center",
    bg: "background.muted",
    color: "text.app",
    display: "flex",
    fontSize: "1",
    fontWeight: "500",
    gap: "1",
    h: "calc(1.3125rem)",
    justifyContent: "center",
    px: "1.5",
    rounded: "sm",
    w: "fit-content",
    whiteSpace: "nowrap",
  },
})

const removeButtonStyles = cva({
  base: {
    _hover: {
      opacity: "1",
    },
    ml: "-1",
    opacity: "0.5",
  },
})

const StyledChip = styled(ComboboxPrimitive.Chip, chipStyles)
const StyledRemoveButton = styled(Button, removeButtonStyles)

export type ComboboxChipProps = React.ComponentProps<typeof ComboboxPrimitive.Chip> &
  ComboboxPrimitive.Chip.Props &
  JsxStyleProps & {
    showRemove?: boolean
  }

export const ComboboxChip = ({ children, showRemove = true, ...props }: ComboboxChipProps) => {
  return (
    <StyledChip data-slot="combobox-chip" {...props}>
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          data-slot="combobox-chip-remove"
          render={
            <StyledRemoveButton size="xs" variant="ghost">
              <Icons.close pointerEvents="none" size={12} />
            </StyledRemoveButton>
          }
        />
      )}
    </StyledChip>
  )
}
