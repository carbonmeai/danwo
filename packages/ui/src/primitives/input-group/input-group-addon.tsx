import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const inputGroupAddonStyles = cva({
  base: {
    ".group\\/input-group[data-disabled=true] &": {
      opacity: "0.5",
    },
    "& > kbd": {
      rounded: "sm",
    },

    '& > svg:not([class*="size-"])': {
      h: "4",
      w: "4",
    },

    alignItems: "center",
    color: "text.muted",
    cursor: "text",
    display: "flex",
    fontSize: "1",
    fontWeight: "500",
    gap: "2",
    h: "auto",
    justifyContent: "center",
    py: "1.5",
    userSelect: "none",
  },
  defaultVariants: {
    align: "inline-start",
  },
  variants: {
    align: {
      "block-end": {
        ".group\\/input-group:has(> input) &": {
          pb: "2",
        },
        "&.border-t": {
          pt: "2",
        },
        justifyContent: "flex-start",
        order: "9999",
        pb: "2",
        px: "2.5",
        w: "full",
      },
      "block-start": {
        ".group\\/input-group:has(> input) &": {
          pt: "2",
        },
        "&.border-b": {
          pb: "2",
        },
        justifyContent: "flex-start",
        order: "-9999",
        pt: "2",
        px: "2.5",
        w: "full",
      },
      "inline-end": {
        "&:has(> button)": {
          mr: "-0.3rem",
        },
        "&:has(> kbd)": {
          mr: "-0.15rem",
        },
        order: "9999",
        pr: "2",
      },
      "inline-start": {
        "&:has(> button)": {
          ml: "-0.3rem",
        },
        "&:has(> kbd)": {
          ml: "-0.15rem",
        },
        order: "-9999",
        pl: "2",
      },
    },
  },
})

const StyledInputGroupAddon = styled("div", inputGroupAddonStyles)

export type InputGroupAddonVariants = RecipeVariantProps<typeof inputGroupAddonStyles>

export type InputGroupAddonProps = React.ComponentProps<"div"> &
  JsxStyleProps &
  InputGroupAddonVariants

export const InputGroupAddon = ({ align = "inline-start", ...props }: InputGroupAddonProps) => {
  return (
    <StyledInputGroupAddon
      align={align}
      data-align={align}
      data-slot="input-group-addon"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }

        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      role="group"
      {...props}
    />
  )
}
