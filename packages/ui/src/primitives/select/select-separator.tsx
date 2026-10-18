import { styled } from "@danwo/ui/jsx"
import { Select as SelectPrimitive } from "radix-ui"
import type * as React from "react"

const StyledSeparator = styled(SelectPrimitive.Separator)

export const SelectSeparator = ({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) => {
  return <StyledSeparator h="1px" mx="4px" my="4px" {...props} />
}
