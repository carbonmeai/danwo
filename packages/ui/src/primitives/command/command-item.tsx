import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps, RecipeVariantProps } from "@danwo/ui/types"
import { Command as CommandPrimitive } from "cmdk"
import type * as React from "react"

import { Icons } from "../../icons/base"

type Props = React.ComponentProps<typeof CommandPrimitive.Item> &
  JsxStyleProps &
  RecipeVariantProps<typeof commandItemStyles> & {
    isSelected?: boolean
  }

const commandItemStyles = cva({
  base: {
    // fontWeight: '500',

    "&[data-disabled=true]": {
      cursor: "not-allowed",
      opacity: "0.5",
      pointerEvents: "none",
    },

    "&[data-selected=true]": {
      bg: "background.muted",
    },
    alignItems: "center",
    cursor: "pointer",
    display: "flex",
    gap: "1",
    mb: "0.5",
    outline: "none",
    pos: "relative",
    userSelect: "none",
  },
  defaultVariants: {
    size: "xs",
  },
  variants: {
    size: {
      auto: {},
      md: {
        fontSize: "2",
        h: "3.8rem",
        px: "3.2",
        rounded: "xl",
      },
      sm: {
        fontSize: "2",
        h: "3.2rem",
        px: "1.5",
        rounded: "lg",
      },
      xs: {
        fontSize: "1",
        h: "1.75rem",
        px: "1.5",
        rounded: "lg",
      },
    },
  },
})

const StyledItem = styled(CommandPrimitive.Item, commandItemStyles)

export const CommandItem = ({ isSelected, children, ...props }: Props) => {
  return (
    <StyledItem data-slot="command-item" {...props}>
      {children}

      {isSelected && (
        <Icons.check mr="1" pos="absolute" right="1" top="50%" transform="translateY(-50%)" />
      )}
    </StyledItem>
  )
}
