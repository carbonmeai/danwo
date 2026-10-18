import { Tooltip as TooltipPrimitive } from "radix-ui"

import { TooltipProvider } from "./tooltip-provider"

type Props = {
  children: React.ReactNode
}

export const Tooltip = ({ children }: Props) => {
  return (
    <TooltipProvider delayDuration={100}>
      <TooltipPrimitive.Root data-slot="tooltip">{children}</TooltipPrimitive.Root>
    </TooltipProvider>
  )
}
