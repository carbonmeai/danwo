import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Accordion as AccordionPrimitive } from "radix-ui"
import type * as React from "react"

const accordionHeaderStyle = cva({
  base: {
    display: "flex",
    w: "100%",
  },
})

const StyledAccordionHeader = styled(AccordionPrimitive.Header, accordionHeaderStyle)

const accordionTriggerStyle = cva({
  base: {
    "&[data-state=closed]": {
      "& .caret": {
        transform: "rotate(-90deg)",
      },
    },
    alignItems: "center",
    cursor: "pointer",
    display: "flex",
    flex: "1",

    fontWeight: "500",
    gap: "0.625rem",
    transition: "all",
  },
  variants: {
    look: {
      grey: {
        _hover: {
          _disabled: {
            bg: "background.muted",
          },
        },
        bg: "background.muted",
      },
      transparent: {
        _hover: {
          bg: "background.muted",
        },
        bg: "transparent",
      },
    },
  },
})

const StyledAccordionTrigger = styled(AccordionPrimitive.Trigger, accordionTriggerStyle)

type ButtonVariants = RecipeVariantProps<typeof accordionTriggerStyle>

type Props = React.ComponentProps<typeof AccordionPrimitive.Trigger> &
  JsxStyleProps &
  ButtonVariants & { showCaret?: boolean; triggerHeaderProps?: JsxStyleProps }

export const AccordionTrigger = ({ children, triggerHeaderProps, ...props }: Props) => {
  return (
    <StyledAccordionHeader {...triggerHeaderProps}>
      <StyledAccordionTrigger {...props}>{children}</StyledAccordionTrigger>
    </StyledAccordionHeader>
  )
}
