import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Command as CommandPrimitive } from "cmdk"
import type * as React from "react"

type Props = React.ComponentProps<typeof CommandPrimitive.Group> &
  JsxStyleProps & {
    icon?: React.ReactNode
  }

const commandGroupStyles = cva({
  base: {
    "& [cmdk-group-heading]": {
      color: "text.muted",
      fontSize: "1",
      fontWeight: "500",
      mb: "1",
      px: "1.5",
    },
    overflowX: "hidden",
  },
})

const StyledGroup = styled(CommandPrimitive.Group, commandGroupStyles)

export const CommandGroup = ({ ...props }: Props) => {
  return <StyledGroup data-slot="command-group" {...props} />
}
