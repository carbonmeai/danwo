import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Popover as PopoverPrimitive } from "radix-ui"
import type * as React from "react"

import { AnimateChangeInHeight } from "../animated-height"
import { popoverContentStyles } from "./popover-content-styles"

const StyledPopoverContent = styled(PopoverPrimitive.Content, popoverContentStyles)

export type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Content> &
  JsxStyleProps

export const PopoverContent: React.FC<PopoverContentProps> = ({
  align = "center",
  sideOffset = 4,
  children,
  style,
  ...props
}) => {
  return (
    <PopoverPrimitive.Portal>
      <StyledPopoverContent
        align={align}
        data-slot="popover-content"
        sideOffset={sideOffset}
        style={{
          ...style,
        }}
        {...props}
      >
        <AnimateChangeInHeight duration={0.05}>{children}</AnimateChangeInHeight>
      </StyledPopoverContent>
    </PopoverPrimitive.Portal>
  )
}
