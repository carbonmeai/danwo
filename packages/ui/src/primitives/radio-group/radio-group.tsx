import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import type * as React from "react"

const radioGroupStyles = cva({
  base: {
    display: "grid",
    gap: "2",
    w: "full",
  },
})

const StyledRadioGroup = styled(RadioGroupPrimitive.Root, radioGroupStyles)

type RadioGroupProps = React.ComponentProps<typeof RadioGroupPrimitive.Root> & JsxStyleProps

export const RadioGroup = (props: RadioGroupProps) => (
  <StyledRadioGroup data-slot="radio-group" {...props} />
)
