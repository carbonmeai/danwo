import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

const fieldStyles = cva({
  base: {
    '&[data-invalid="true"]': {
      color: "text.error",
    },
    display: "flex",
    gap: "1",
    w: "100%",
  },
  defaultVariants: {
    orientation: "vertical",
  },
  variants: {
    orientation: {
      horizontal: {
        "& > [data-slot=field-label]": {
          flex: "1 1 auto",
        },
        "&:has(> [data-slot=field-content])": {
          "& > [role=checkbox], & > [role=radio]": {
            mt: "px",
          },
          alignItems: "start",
        },
        alignItems: "center",
        flexDirection: "row",
      },
      responsive: {
        "@field-group/md": {
          "& > [data-slot=field-label]": {
            flex: "1 1 auto",
          },
          "& > *": {
            w: "auto",
          },
          "&:has(> [data-slot=field-content])": {
            "& > [role=checkbox], & > [role=radio]": {
              mt: "px",
            },
            alignItems: "start",
          },
          alignItems: "center",
          flexDirection: "row",
        },
        "& > .sr-only": {
          w: "auto",
        },
        "& > *": {
          w: "100%",
        },
        flexDirection: "column",
      },
      vertical: {
        "& > .sr-only": {
          w: "auto",
        },
        "& > *": {
          w: "100%",
        },
        flexDirection: "column",
      },
    },
  },
})

const StyledField = styled("div", fieldStyles)

type FieldProps = React.ComponentProps<"div"> &
  JsxStyleProps &
  RecipeVariantProps<typeof fieldStyles>

export const Field = ({ orientation = "vertical", ...props }: FieldProps) => {
  return (
    <StyledField
      className="group/field"
      data-orientation={orientation}
      data-slot="field"
      orientation={orientation}
      role="group"
      {...props}
    />
  )
}
