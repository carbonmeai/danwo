import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Accordion as AccordionPrimitive } from "radix-ui"
import type * as React from "react"

import { AnimateChangeInHeight } from "../animated-height"
import { FadeIn } from "../framer"

type Props = React.ComponentProps<typeof AccordionPrimitive.Content> & JsxStyleProps

const accordionContentStyle = cva({
  base: {
    "&[data-state=closed]": {
      transform: "scaleY(0)",
    },

    "&[data-state=open]": {
      transform: "scaleY(1)",
    },
    fontSize: "1",
    overflow: "hidden",
    /*
     * NOTE: using transition all and animating the height made the slide up and down a bit janky so Faithful ported the accordion to use scaleY instead
     * transition: 'all',
     */
    transition: "transform",
  },
})

const StyledAccordionContent = styled(AccordionPrimitive.Content, accordionContentStyle)

export const AccordionContent = ({ children, ...props }: Props) => {
  return (
    <AnimateChangeInHeight>
      <StyledAccordionContent {...props}>
        <FadeIn
          transition={{
            delay: 0.2,
            duration: 0.2,
            ease: "easeInOut",
          }}
        >
          {children}
        </FadeIn>
      </StyledAccordionContent>
    </AnimateChangeInHeight>
  )
}
