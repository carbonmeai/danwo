import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps, RecipeVariantProps } from "@danwo/ui/types"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import type React from "react"

import { Icons } from "../../icons/base"

const triggerStyles = cva({
  base: {
    _disabled: {
      opacity: 0.5,
      pointerEvents: "none",
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
        h: "2.8rem",
        px: "1.5",
        rounded: "lg",
      },
    },
  },
})

type Props = React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
} & JsxStyleProps &
  RecipeVariantProps<typeof triggerStyles>

const StyledSubTrigger = styled(ContextMenuPrimitive.SubTrigger, triggerStyles)

export const ContextMenuSubTrigger = ({ inset, children, ...props }: Props) => {
  return (
    <StyledSubTrigger
      data-slot="context-menu-sub-trigger"
      style={{ paddingLeft: inset ? "3.2rem" : undefined }}
      {...props}
    >
      {children}
      <Icons.caretRight ml="auto" />
    </StyledSubTrigger>
  )
}
