import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Command as CommandPrimitive } from "cmdk"
import type * as React from "react"

const StyledCommand = styled(CommandPrimitive, {})

type Props = React.ComponentProps<typeof CommandPrimitive> & JsxStyleProps

export const Command = ({ filter: _filter, ...props }: Props) => {
  return <StyledCommand data-slot="command" {...props} />
}
