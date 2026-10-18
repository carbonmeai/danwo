import type { RecipeVariantProps } from "@danwo/ui/css"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import * as SliderPrimitive from "@radix-ui/react-slider"
import * as React from "react"

const trackStyles = cva({
  base: {
    borderRadius: "full",
    flexGrow: 1,
    height: "0.8rem",
    position: "relative",
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
      success: {
        bg: "success.9",
      },
      successOutline: {
        bg: "success.9",
        border: "success",
      },
      usage: {},
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

const StyledTrack = styled(SliderPrimitive.Track, trackStyles)

type RootVariants = RecipeVariantProps<typeof trackStyles>
export type SliderTrackProps = React.ComponentProps<typeof SliderPrimitive.Track> &
  JsxStyleProps &
  RootVariants

export const SliderTrack = (props: SliderTrackProps) => {
  return <StyledTrack {...props} />
}
