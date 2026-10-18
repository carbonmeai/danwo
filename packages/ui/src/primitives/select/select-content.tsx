import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Select as SelectPrimitive } from "radix-ui"
import type * as React from "react"

const selectContentStyles = css({
  _light: {
    bg: "white",
    glass: "none",
  },
  "&[data-state=closed]": {
    animation: "popoverHide",
  },
  "&[data-state=open]": {
    animation: "popoverUpIn",
  },
  bg: "background.popover",
  border: "subtle",
  glass: "popup",
  minW: "6.25rem",
  overflow: "hidden",
  pos: "relative",
  rounded: "xl",
  w: "100%",
  zIndex: "100",
})

const selectContenPoppertStyles = css({
  "&[data-side=bottom]": {
    transform: "translateY(0.125rem)",
  },
  "&[data-side=left]": {
    transform: "translateX(0.125rem)",
  },
  "&[data-side=right]": {
    transform: "translateX(0.125rem)",
  },
  "&[data-side=top]": {
    transform: "translateY(0.125rem)",
  },
})

export const SelectContent = ({
  className,
  children,
  position = "popper",
  sideOffset = 5,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & JsxStyleProps) => {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cx(
          selectContentStyles,
          position === "popper" && selectContenPoppertStyles,
          className,
        )}
        position={position}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cx(css({ p: "4px", rounded: "inherit" }))}
          style={
            position === "popper"
              ? {
                  height: "var(--radix-select-trigger-height)",
                  minWidth: "var(--radix-select-trigger-width",
                  width: "100%",
                }
              : {}
          }
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}
