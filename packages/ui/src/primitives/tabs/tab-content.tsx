import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Tabs as TabsPrimitive } from "radix-ui"
import type * as React from "react"

const tabContentStyles = cva({
  base: {
    _focusVisible: {
      outline: "none",
    },
  },
})

const StyledTabContent = styled(TabsPrimitive.Content, tabContentStyles)

export const TabContent = (
  props: React.ComponentProps<typeof TabsPrimitive.Content> & JsxStyleProps,
) => {
  return <StyledTabContent {...props} />
}
