import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const inputGroupStyles = cva({
  base: {
    _dark: {
      _disabled: {
        bg: "palette.gray.3/80",
      },
      bg: "palette.gray.3/30",
    },

    _disabled: {
      bg: "palette.gray.3/50",
      opacity: "0.5",
    },

    _inComboboxContentFocusWithin: {
      borderColor: "inherit",
      ring: "0",
    },

    "&:has([data-slot][aria-invalid=true])": {
      borderColor: "brand.error.9",
      ring: "3px",
      ringColor: "brand.error.3",
    },
    "&:has([data-slot=input-group-control]:focus-visible)": {
      borderColor: "border.focused",
      ring: "3px",
      ringColor: "brand.primary.3/50",
    },

    "&:has(> [data-align=block-end])": {
      "& > input": {
        pt: "3",
      },
      flexDirection: "column",
      h: "auto",
    },

    "&:has(> [data-align=block-start])": {
      "& > input": {
        pb: "3",
      },
      flexDirection: "column",
      h: "auto",
    },

    "&:has(> [data-align=inline-end])": {
      "& > input": {
        pr: "1.5",
      },
    },

    "&:has(> [data-align=inline-start])": {
      "& > input": {
        pl: "1.5",
      },
    },

    "&:has(> textarea)": {
      h: "auto",
    },

    alignItems: "center",
    border: "subtle",
    display: "flex",
    fontSize: "1",
    h: "1.75rem",
    minW: "0",
    outline: "none",
    pos: "relative",
    rounded: "lg",
    transition: "colors",
    w: "full",
  },
})

const StyledInputGroup = styled("div", inputGroupStyles)

export type InputGroupVariants = RecipeVariantProps<typeof inputGroupStyles>

export type InputGroupProps = React.ComponentProps<"div"> & JsxStyleProps & InputGroupVariants

export const InputGroup = ({ ...props }: InputGroupProps) => {
  return (
    <StyledInputGroup
      className="group/input-group"
      data-slot="input-group"
      role="group"
      {...props}
    />
  )
}
