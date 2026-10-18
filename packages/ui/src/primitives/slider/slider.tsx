import type { RecipeVariantProps } from "@danwo/ui/css"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import * as SliderPrimitive from "@radix-ui/react-slider"
import * as React from "react"

// Styles for the slider root
const rootStyles = cva({
  base: {
    alignItems: "center",
    bg: "background.muted",
    display: "flex",
    h: "2.4rem",
    pos: "relative",
    rounded: "full",
    w: "full",
  },
  defaultVariants: {
    size: "xs",
  },
  variants: {
    look: {
      gray: {
        bg: "gray.2",
      },
      grayOutline: {
        bg: "gray.2",
        border: "subtle",
      },
    },
    size: {
      lg: {
        h: "2rem",
      },
      md: {
        h: "1.6rem",
      },
      sm: {
        h: "1.2rem",
      },
      xs: {
        h: "0.8rem",
      },
      xxs: {
        h: "0.4rem",
      },
    },
  },
})

const StyledRoot = styled(SliderPrimitive.Root, rootStyles)

type RootVariants = RecipeVariantProps<typeof rootStyles>
export type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> &
  JsxStyleProps &
  RootVariants

// Slider component without forwardRef
export const Slider = (props: SliderProps) => {
  return <StyledRoot {...props} />
}
