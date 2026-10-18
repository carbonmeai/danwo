import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Label as LabelPrimitive } from "radix-ui"

const fieldLabelStyles = cva({
  base: {
    ".group\\/field[data-disabled=true] &": {
      opacity: "0.5",
    },
    "&:has(> [data-slot=field])": {
      "& > *[data-slot=field]": {
        p: "4",
      },
      border: "subtle",
      flexDirection: "column",
      rounded: "lg",
      w: "100%",
    },
    "&[data-state=checked]": {
      _dark: {
        bg: "brand.primary.10",
      },
      bg: "brand.primary.5",
      borderColor: "brand.primary",
    },
    color: "text.label",
    fontSize: "1",
    lineHeight: "tight",
    textStyle: "label",
    w: "fit-content",
  },
})

const StyledFieldLabel = styled(LabelPrimitive.Root, fieldLabelStyles)

export const FieldLabel = ({
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & JsxStyleProps) => {
  return <StyledFieldLabel data-slot="field-label" {...props} />
}
