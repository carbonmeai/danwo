import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Command as CommandPrimitive } from "cmdk"
import type * as React from "react"

const StyledEmpty = styled(CommandPrimitive.Empty)

export const CommandEmpty = (
  props: React.ComponentProps<typeof CommandPrimitive.Empty> & JsxStyleProps,
) => {
  return <StyledEmpty data-slot="command-empty" px="2.5" py="5" {...props} />
}
