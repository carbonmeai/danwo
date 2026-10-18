import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

const fieldContentStyles = cva({
  base: {
    display: "flex",
    flex: "1",
    flexDirection: "column",
    gap: "1.5",
    lineHeight: "tight",
  },
})

const StyledFieldContent = styled("div", fieldContentStyles)

export const FieldContent = ({ ...props }: React.ComponentProps<"div"> & JsxStyleProps) => {
  return <StyledFieldContent data-slot="field-content" {...props} />
}
