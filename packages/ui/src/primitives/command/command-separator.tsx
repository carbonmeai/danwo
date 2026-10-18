import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Command as CommandPrimitive } from "cmdk"
import type * as React from "react"

const StyledCommandSeparator = styled(CommandPrimitive.Separator)

export const CommandSeparator = ({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator> & JsxStyleProps) => {
  return (
    <StyledCommandSeparator
      bg="background.muted"
      data-slot="command-separator"
      h="1px"
      my="1"
      w="full"
      {...props}
    />
  )
}
