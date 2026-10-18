import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "radix-ui"
import type * as React from "react"

const sidebarMenuSubButtonStyles = cva({
  base: {
    _disabled: {
      opacity: "0.5",
      pointerEvents: "none",
    },
    _focusVisible: {
      ring: "2px",
      ringColor: "border.focused",
    },
    _hover: {
      bg: "brand.panel.6",
      color: "text.app",
    },
    "& svg": {
      color: "text.muted",
      flexShrink: 0,
      h: "3.5",
      w: "3.5",
    },
    /*
     * selected sub-item = the hover effect, held (no bold — only the parent
     * project row bolds when active)
     */
    "&[data-active=true]": {
      bg: "brand.panel.10",
      color: "text.app",
    },
    "&[data-active=true] svg": {
      color: "text.app",
    },
    alignItems: "center",
    color: "text.muted",
    cursor: "pointer",
    display: "flex",
    gap: "2",
    minW: "0",
    outline: "none",
    overflow: "hidden",
    ring: "none",
    textOverflow: "ellipsis",
    w: "full",
    whiteSpace: "nowrap",
  },
  defaultVariants: {
    size: "md",
  },
  variants: {
    size: {
      md: {
        fontSize: "0.75rem",
        h: "7",
        px: "2",
        rounded: "md",
      },
      sm: {
        fontSize: "0.75rem",
        h: "7",
        px: "2",
        rounded: "md",
      },
    },
  },
})

type SidebarMenuSubButtonVariants = RecipeVariantProps<typeof sidebarMenuSubButtonStyles>

const StyledSubButton = styled("a", sidebarMenuSubButtonStyles)
const StyledSlotSubButton = styled(Slot.Root, sidebarMenuSubButtonStyles)

export type SidebarMenuSubButtonProps = React.ComponentProps<"a"> &
  SidebarMenuSubButtonVariants &
  JsxStyleProps & {
    asChild?: boolean
    isActive?: boolean
  }

export const SidebarMenuSubButton = ({
  asChild = false,
  size = "md",
  isActive = false,
  ...props
}: SidebarMenuSubButtonProps) => {
  const Component = asChild ? StyledSlotSubButton : StyledSubButton

  return (
    <Component
      data-active={isActive}
      data-size={size}
      data-slot="sidebar-menu-sub-button"
      size={size}
      {...props}
    />
  )
}
