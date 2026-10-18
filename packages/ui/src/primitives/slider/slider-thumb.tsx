import type { RecipeVariantProps } from "@danwo/ui/css"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import * as SliderPrimitive from "@radix-ui/react-slider"
import * as React from "react"

const thumbStyles = cva({
  base: {
    _dark: {
      bg: "brand.primary.1",
    },
    alignItems: "center",
    borderRadius: "full",
    display: "flex",
    height: "1.6rem",
    width: "1.6rem",
  },
  defaultVariants: {
    size: "md",
  },
  variants: {
    look: {
      error: {
        bg: "error.9",
      },
      purple: {
        bg: "brand.primary.9",
      },
      purpleOutline: {
        bg: "brand.primary.1",
        border: "focused",
      },
      success: {
        bg: "success.9",
      },
      usage: {},
    },
    size: {
      lg: {
        h: "2rem",
        w: "2rem",
      },
      md: {
        h: "1.6rem",
        w: "1.6rem",
      },
      sm: {
        h: "1.2rem",
        w: "1.2rem",
      },
      xs: {
        h: "0.8rem",
        w: "0.8rem",
      },
      xxs: {
        h: "0.4rem",
        w: "0.4rem",
      },
    },
  },
})

const StyledThumb = styled(SliderPrimitive.Thumb, thumbStyles)

type ThumbVariants = RecipeVariantProps<typeof thumbStyles>
export type SliderThumbProps = React.ComponentProps<typeof SliderPrimitive.Thumb> &
  JsxStyleProps &
  ThumbVariants

export const SliderThumb = ({ children, ...props }: SliderThumbProps) => {
  return <StyledThumb {...props}>{children}</StyledThumb>
}
