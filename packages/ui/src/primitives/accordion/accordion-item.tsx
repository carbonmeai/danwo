import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Accordion as AccordionPrimitive } from "radix-ui"
import type * as React from "react"

const StyledAccordionItem = styled(AccordionPrimitive.Item)

export const AccordionItem = ({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item> & JsxStyleProps) => {
  return <StyledAccordionItem {...props} />
}
