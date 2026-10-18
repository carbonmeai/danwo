import { css, cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import type * as React from "react"

const radioGroupItemStyles = cva({
  base: {
    _disabled: { cursor: "not-allowed", opacity: "0.5" },
    _focusVisible: { border: "focused" },
    _invalid: { borderColor: "brand.error.9" },
    "&[data-state=checked]": {
      bg: "brand.primary.9",
      border: "1.5px solid transparent",
    },
    alignItems: "center",
    aspectRatio: "square",
    border: "1.5px solid token(colors.palette.gray.4)",
    cursor: "pointer",
    display: "flex",
    flexShrink: "0",
    h: "1rem",
    justifyContent: "center",
    outline: "none",
    position: "relative",
    rounded: "full",
    w: "1rem",
  },
})

const indicatorStyles = cva({
  base: {
    alignItems: "center",
    display: "flex",
    h: "full",
    justifyContent: "center",
    w: "full",
  },
})

const StyledRadioGroupItem = styled(RadioGroupPrimitive.Item, radioGroupItemStyles)
const StyledIndicator = styled(RadioGroupPrimitive.Indicator, indicatorStyles)

type RadioGroupItemProps = React.ComponentProps<typeof RadioGroupPrimitive.Item> & JsxStyleProps

export const RadioGroupItem = (props: RadioGroupItemProps) => (
  <StyledRadioGroupItem data-slot="radio-group-item" {...props}>
    <StyledIndicator data-slot="radio-group-indicator">
      <svg
        className={css({
          color: { base: "white", _dark: "background.app" },
          h: "0.5rem",
          w: "0.5rem",
        })}
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <circle cx="8" cy="8" r="8" />
      </svg>
    </StyledIndicator>
  </StyledRadioGroupItem>
)
