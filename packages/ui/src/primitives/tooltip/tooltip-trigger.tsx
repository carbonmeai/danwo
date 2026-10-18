import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Tooltip as TooltipPrimitive } from "radix-ui"

const StyledTrigger = styled(TooltipPrimitive.Trigger)

export const TooltipTrigger = ({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & JsxStyleProps) => {
  return <StyledTrigger data-slot="tooltip-trigger" {...props} />
}
