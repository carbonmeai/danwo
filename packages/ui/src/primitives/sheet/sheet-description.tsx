import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Dialog as SheetPrimitive } from "radix-ui"
import type * as React from "react"

const StyledDescription = styled(SheetPrimitive.Description)

type Props = React.ComponentProps<typeof SheetPrimitive.Description> & JsxStyleProps

export const SheetDescription: React.FC<Props> = (props) => {
  return <StyledDescription color="text.muted" fontSize="1" fontWeight="500" {...props} />
}
