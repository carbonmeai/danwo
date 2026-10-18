import type { JsxStyleProps } from "@danwo/ui/types"
import type { HTMLMotionProps } from "motion/react"

import { MotionDiv } from "./motion-div"

export type FadeInProps = Omit<JsxStyleProps, "transition"> & HTMLMotionProps<"div">

export const FadeIn = ({ ...props }: FadeInProps) => {
  return (
    <MotionDiv
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      {...props}
    />
  )
}
