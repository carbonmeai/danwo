import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import { Select as SelectPrimitive } from "radix-ui"
import type * as React from "react"

type Props = React.ComponentProps<typeof SelectPrimitive.Label>

const styledLabel = cva({
  base: {
    fontSize: "1",
    pr: "4",
    py: "1.5",
  },
})

const StyledLabel = styled(SelectPrimitive.Label, styledLabel)

export const SelectLabel = (props: Props) => {
  return <StyledLabel {...props} />
}
