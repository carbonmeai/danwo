import { css, cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import type * as React from "react"

import { Icons } from "../../icons/base"
import type { TIcon } from "../../icons/types"

type Props = React.ComponentProps<typeof CheckboxPrimitive.Root> &
  JsxStyleProps & {
    icon?: TIcon
  }

const checkboxStyles = cva({
  base: {
    _disabled: { cursor: "not-allowed", opacity: "0.5" },

    "&[data-state=checked]": {
      bg: "brand.primary.9",
      border: "1.5px solid transparent",
    },
    border: "1.5px solid token(colors.palette.gray.4)",
    cursor: "pointer",
    display: "flex",
    h: "1rem",
    rounded: "md",
    w: "1rem",
  },
})

const StyledCheckbox = styled(CheckboxPrimitive.Root, checkboxStyles)

const indicatorStyles = cva({
  base: {
    alignItems: "center",
    display: "flex",
    justifyContent: "center",
    overflow: "hidden",
    rounded: "inherit",
  },
})

const StyledIndicator = styled(CheckboxPrimitive.Indicator, indicatorStyles)

export const Checkbox = ({ icon, ...props }: Props) => {
  const Icon = icon || Icons.check

  return (
    <StyledCheckbox data-slot="checkbox" {...props}>
      <StyledIndicator data-slot="checkbox-indicator">
        <Icon
          className={css({
            _focus: { border: "focused", outline: "none" },
            // The checked box is the primary colour, white in dark mode, so the mark takes the page colour there.
            color: { base: "white", _dark: "background.app" },
            h: "0.75rem",
            rounded: "md",
            w: "0.75rem",
          })}
        />
      </StyledIndicator>
    </StyledCheckbox>
  )
}
