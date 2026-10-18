import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Label as LabelPrimitive } from "radix-ui"
import type * as React from "react"

const labelStyles = cva({
  base: {
    _peerDisabled: {
      cursor: "not-allowed",
      opacity: "0.5",
    },
    ".group[data-disabled=true] &": {
      opacity: "0.5",
      pointerEvents: "none",
    },
    alignItems: "center",
    display: "flex",
    fontSize: "2",
    fontWeight: "500",
    gap: "2",
    lineHeight: "1",
    userSelect: "none",
  },
})

const StyledLabel = styled(LabelPrimitive.Root, labelStyles)

export const Label = ({
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & JsxStyleProps) => {
  return <StyledLabel data-slot="label" {...props} />
}
