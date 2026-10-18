import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

import { Icons } from "../../icons/base"
import { Span } from "../typography"

const itemStyles = cva({
  base: {
    "& svg": {
      flexShrink: "0",
      pointerEvents: "none",
    },

    '& svg:not([class*="size-"])': {
      h: "4",
      w: "4",
    },

    "&[data-disabled]": {
      opacity: "0.5",
      pointerEvents: "none",
    },

    "&[data-highlighted]": {
      bg: "background.muted",
      color: "text.app",
    },

    alignItems: "center",
    cursor: "default",
    display: "flex",
    fontSize: "1",
    gap: "2",
    outline: "none",
    pl: "1.5",
    pos: "relative",
    pr: "2rem",
    py: "1",
    rounded: "md",
    userSelect: "none",
    w: "full",
  },
})

const StyledItem = styled(ComboboxPrimitive.Item, itemStyles)

export type ComboboxItemProps = ComboboxPrimitive.Item.Props & JsxStyleProps

export const ComboboxItem = ({ children, ...props }: ComboboxItemProps) => {
  return (
    <StyledItem data-slot="combobox-item" {...props}>
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <Span
            alignItems="center"
            display="flex"
            h="4"
            justifyContent="center"
            pointerEvents="none"
            pos="absolute"
            right="2"
            w="4"
          >
            <Icons.check pointerEvents="none" size={14} />
          </Span>
        }
      />
    </StyledItem>
  )
}
