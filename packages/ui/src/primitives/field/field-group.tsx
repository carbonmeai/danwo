import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

const fieldGroupStyles = cva({
  base: {
    containerName: "field-group",
    containerType: "inline-size",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    width: "100%",
  },
})
const StyledFieldGroup = styled("div", fieldGroupStyles)

export const FieldGroup = ({ ...props }: React.ComponentProps<"div"> & JsxStyleProps) => {
  return <StyledFieldGroup className="group/field-group" data-slot="field-group" {...props} />
}
