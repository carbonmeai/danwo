import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Tabs as TabsPrimitive } from "radix-ui"
import type * as React from "react"

const tabTriggerStyles = cva({
  base: {
    _disabled: {
      opacity: "0.5",
      pointerEvents: "none",
    },
    _focusVisible: {
      outline: "none",
      ring: "2",
      ringColor: "ring",
      ringOffset: "2",
    },
    "&[data-state=active]": {
      bg: { base: "background.app", _dark: "brand.panel.10" },
      color: "text.app",
      shadow: "sXs",
    },
    _hover: { color: "text.app" },
    alignItems: "center",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "1.5",
    fontWeight: "500",
    h: "7",
    justifyContent: "center",
    px: "3",
    ringOffset: "background.app",
    rounded: "lg",
    transition: "all",
    whiteSpace: "nowrap",
  },
  variants: {
    variant: {
      pill: {},
      /**
       * The record page's tab strip. Overrides the pill's active treatment
       * rather than extending it: a filled chip and an underline read as two
       * different selections when both are showing.
       */
      underline: {
        "&[data-state=active]": {
          bg: "transparent",
          borderColor: "brand.solid",
          color: "text.app",
          shadow: "none",
        },
        borderBottomWidth: "2px",
        // transparent rather than absent, so selecting a tab shifts nothing
        borderColor: "transparent",
        color: "text.muted",
        // fills the strip so the active underline sits on the rule, not above it
        h: "full",
        px: "0",
        rounded: "none",
        w: "auto",
      },
    },
  },
  defaultVariants: { variant: "pill" },
})

const StyledTabTrigger = styled(TabsPrimitive.Trigger, tabTriggerStyles)

export const TabTrigger = (
  props: React.ComponentProps<typeof TabsPrimitive.Trigger> &
    JsxStyleProps & { variant?: "pill" | "underline" },
) => {
  return <StyledTabTrigger {...props} />
}
