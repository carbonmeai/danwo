import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Tabs as TabsPrimitive } from "radix-ui"
import type * as React from "react"

const tabListStyles = cva({
  base: {
    alignItems: "center",
    bg: "brand.panel.5",
    color: "text.muted",
    display: "inline-flex",
    gap: "0.5",
    justifyContent: "center",
    p: "0.5",
    rounded: "10px",
  },
  variants: {
    variant: {
      /** a segmented control: 28px tabs on a grey track, the selected one lifted */
      pill: {},
      /** a full-width rule the active tab's underline sits on */
      underline: {
        bg: "transparent",
        borderBottomWidth: "1px",
        borderColor: "brand.panel.4",
        display: "flex",
        gap: "5",
        // the same 44px band the header rows use
        h: "2.75rem",
        justifyContent: "flex-start",
        p: "0",
        rounded: "none",
        w: "full",
      },
    },
  },
  defaultVariants: { variant: "pill" },
})

const StyledTabList = styled(TabsPrimitive.List, tabListStyles)

export const TabsList = (
  props: React.ComponentProps<typeof TabsPrimitive.List> &
    JsxStyleProps & { variant?: "pill" | "underline" },
) => {
  return <StyledTabList {...props} />
}
