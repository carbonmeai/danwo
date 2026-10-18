import { Tooltip as TooltipPrimitive } from "radix-ui"

export const TooltipProvider = ({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) => {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />
}
