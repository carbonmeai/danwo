import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

import { Icons } from "../../icons/base"

const triggerStyles = cva({
  base: {
    '& svg:not([class*="size-"])': {
      h: "4",
      w: "4",
    },
  },
})

const StyledTrigger = styled(ComboboxPrimitive.Trigger, triggerStyles)

export type ComboboxTriggerProps = ComboboxPrimitive.Trigger.Props & JsxStyleProps

export const ComboboxTrigger = ({ children, ...props }: ComboboxTriggerProps) => {
  return (
    <StyledTrigger data-slot="combobox-trigger" {...props}>
      {children}
      <Icons.caretDown color="text.muted" pointerEvents="none" />
    </StyledTrigger>
  )
}
