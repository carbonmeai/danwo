import { isCssProperty, styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { type HTMLMotionProps, isValidMotionProp } from "motion/react"
import * as m from "motion/react-m"

type Props = Omit<JsxStyleProps, "transition"> &
  HTMLMotionProps<"div"> & {
    className?: string
  }

export const MotionDiv = styled(
  m.div,
  {},
  {
    shouldForwardProp: (prop, variantKeys) =>
      isValidMotionProp(prop) || (!variantKeys.includes(prop) && !isCssProperty(prop)),
  },
) as React.FC<Props>
