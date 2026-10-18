import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const textareaStyles = cva({
  base: {
    _dark: {
      _disabled: {
        bg: "palette.gray.3/80",
      },
      bg: "palette.gray.3/30",
    },

    _disabled: {
      bg: "palette.gray.3/50",
      cursor: "not-allowed",
      opacity: "0.5",
    },

    // a borderless field: a darker fill on hover, and a soft grey ring while typing — never a coloured outline
    _hover: { bg: "brand.panel.5" },
    _focus: {
      bg: "brand.panel.3",
      ring: "3px",
      ringColor: { base: "brand.panel.10", _dark: "brand.panel.15" },
    },
    // explicit error state only, as in the input: an empty required field is not an error yet
    "&[aria-invalid=true], &[data-invalid]": {
      _dark: {
        borderColor: "brand.error.9/50",
        ringColor: "brand.error.4",
      },
      borderColor: "brand.error.9",
      ring: "3px",
      ringColor: "brand.error.3",
    },

    _placeholder: {
      color: "text.placeholder",
    },

    /*
     * bg: 'transparent',
     * border: 'subtle',
     */
    color: "text.app",
    display: "flex",
    fieldSizing: "content",
    fontSize: "1",
    minH: "8rem",
    outline: "none",
    px: "2.5",
    py: "2",
    rounded: "lg",
    transition: "colors",
    w: "full",
  },
  defaultVariants: {
    size: "md",
    variant: "subtle",
  },
  variants: {
    size: {
      lg: {
        fontSize: "1",
        px: "3.5",
        py: "3",
        rounded: "xl",
      },
      md: {
        fontSize: "1",
        px: "2.5",
        py: "2",
        rounded: "lg",
      },
      sm: {
        fontSize: "1",
        px: "2",
        py: "1.5",
        rounded: "lg",
      },
    },
    variant: {
      subtle: {
        bg: "background.muted",
        border: "none",
      },
      outline: {
        bg: "transparent",
        border: "subtle",
      },
    },
  },
})

const StyledTextarea = styled("textarea", textareaStyles)

export type TextareaVariants = RecipeVariantProps<typeof textareaStyles>

export type TextareaProps = React.ComponentProps<"textarea"> & JsxStyleProps & TextareaVariants

export const Textarea = ({ size = "md", ...props }: TextareaProps) => {
  return <StyledTextarea data-slot="textarea" size={size} {...props} />
}
