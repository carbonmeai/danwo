import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import type * as React from "react"

type Props = React.ComponentProps<typeof DropdownMenuPrimitive.SubContent> & {
  inset?: boolean
} & JsxStyleProps

const contentStyles = cva({
  base: {
    _light: {
      bg: "white",
    },
    "&[data-state=closed]": {
      animation: "popoverHide",
    },

    "&[data-state=open]": {
      animation: "popoverUpIn",
    },
    bg: "background.popover",
    border: "subtle",
    minW: "8rem",
    /**
     * No margin offset. A 1rem nudge away from the trigger left a dead gap that
     * radix reads as leaving the trigger, so the submenu opened and shut again
     * before the pointer could reach it.
     */
    overflowX: "hidden",
    overflowY: "auto",
    p: "1",
    rounded: "xl",
    shadow: "sLg",
  },
})

const StyledSubContent = styled(DropdownMenuPrimitive.SubContent, contentStyles)

/**
 * Escape steps back one level: it closes this submenu and returns focus to the row that opened it, where Radix would
 * close the whole menu. The submenu's own close key (ArrowLeft) does exactly that.
 */
const closeThisLevel = (event: KeyboardEvent) => {
  event.preventDefault()
  const content =
    event.target instanceof Element
      ? event.target.closest('[data-slot="dropdown-menu-sub-content"]')
      : null

  content?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
}

export const DropdownMenuSubContent = ({ onEscapeKeyDown, ...props }: Props) => {
  return (
    <StyledSubContent
      data-slot="dropdown-menu-sub-content"
      onEscapeKeyDown={(event) => {
        onEscapeKeyDown?.(event)
        if (!event.defaultPrevented) closeThisLevel(event)
      }}
      {...props}
    />
  )
}
