import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

const positionerStyles = cva({
  base: {
    isolation: "isolate",
    zIndex: "150",
  },
})

const popupStyles = cva({
  base: {
    "& [data-slot=input-group]": {
      bg: "palette.gray.3/30",
      border: "none",
      borderColor: "palette.gray.3/30",
      h: "2rem",
      m: "1",
      mb: "0",
      shadow: "none",
    },

    "&[data-chips=true]": {
      minW: "var(--anchor-width)",
    },

    "&[data-closed]": {
      animation: "popoverHide",
    },

    "&[data-open]": {
      animation: "popoverUpIn",
    },

    "&[data-side=bottom]": {
      animation: "slideInFromTop",
    },

    "&[data-side=inline-end]": {
      animation: "slideInFromLeft",
    },

    "&[data-side=inline-start]": {
      animation: "slideInFromRight",
    },

    "&[data-side=left]": {
      animation: "slideInFromRight",
    },

    "&[data-side=right]": {
      animation: "slideInFromLeft",
    },

    "&[data-side=top]": {
      animation: "slideInFromBottom",
    },

    bg: "background.popover",
    bgOrigin: "var(--transform-origin)",
    border: "subtle",
    color: "text.app",
    maxH: "18rem",
    maxW: "var(--available-width)",
    minW: "calc(var(--anchor-width) + 1.75rem)",
    overflow: "hidden",
    pos: "relative",
    rounded: "lg",
    shadow: "md",
    w: "var(--anchor-width)",
  },
})

const StyledPositioner = styled(ComboboxPrimitive.Positioner, positionerStyles)
const StyledPopup = styled(ComboboxPrimitive.Popup, popupStyles)

export type ComboboxContentProps = ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  > &
  JsxStyleProps

export const ComboboxContent = ({
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxContentProps) => {
  return (
    <ComboboxPrimitive.Portal>
      <StyledPositioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        side={side}
        sideOffset={sideOffset}
      >
        <StyledPopup
          className="group/combobox-content"
          data-chips={!!anchor}
          data-slot="combobox-content"
          {...props}
        />
      </StyledPositioner>
    </ComboboxPrimitive.Portal>
  )
}
