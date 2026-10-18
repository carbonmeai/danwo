import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps, RecipeVariantProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import type * as React from "react"

import { Icons } from "../../icons/base"

const triggerStyles = cva({
  base: {
    _disabled: {
      opacity: 0.5,
      pointerEvents: "none",
    },

    _hover: {
      bg: "background.muted",
    },

    _focus: {
      bg: "background.muted",
    },

    "&[data-highlighted]": {
      bg: "background.muted",
    },

    "&[data-state=open]": {
      bg: "background.muted",
    },
    alignItems: "center",
    cursor: "pointer",
    display: "flex",
    outline: "none",
    pos: "relative",
    transition: "colors 200ms",
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

type Props = React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
  /** for a trigger that is already an affordance, like an ellipsis button */
  hideCaret?: boolean
} & JsxStyleProps &
  RecipeVariantProps<typeof triggerStyles>

const StyledTrigger = styled(DropdownMenuPrimitive.SubTrigger, triggerStyles)

export const DropdownMenuSubTrigger = ({ inset, hideCaret, children, ...props }: Props) => {
  return (
    <StyledTrigger
      data-slot="dropdown-menu-sub-trigger"
      style={{ paddingLeft: inset ? "3.2rem" : undefined }}
      {...props}
    >
      <>
        {children}
        {hideCaret ? null : <Icons.caretRight color="text.muted" ml="auto" size={12} />}
      </>
    </StyledTrigger>
  )
}
