import { css, cva, cx, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "radix-ui"
import type * as React from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip"
import { useSidebar } from "./sidebar-provider"

const sidebarMenuButtonStyles = cva({
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
      flexShrink: 0,
      h: "3.5",
      w: "3.5",
    },
    "&[data-active=true]": {
      bg: "brand.panel.10",
      color: "text.app",
    },
    alignItems: "center",
    color: "text.muted",
    cursor: "pointer",
    display: "flex",
    fontSize: "0.875rem",
    gap: "2",
    outline: "none",
    overflow: "hidden",
    ring: "none",
    textAlign: "left",
    textOverflow: "ellipsis",
    transitionDuration: "200ms",
    transitionProperty: "width, height, padding",
    transitionTimingFunction: "linear",
    w: "full",
    whiteSpace: "nowrap",
  },
  defaultVariants: {
    size: "default",
    variant: "default",
  },
  variants: {
    size: {
      default: {
        fontSize: "0.75rem",
        h: "7",
        px: "2",
        rounded: "md",
      },
      lg: {
        "& svg": {
          h: "3.5",
          w: "3.5",
        },
        fontSize: "0.75rem",
        h: "7",
        px: "2",
        rounded: "md",
      },
      sm: {
        fontSize: "0.75rem",
        h: "6",
        px: "2",
        rounded: "md",
      },
    },
    variant: {
      default: {
        _hover: {
          bg: "brand.panel.6",
          color: "text.app",
        },
      },
      outline: {
        _hover: {
          bg: "brand.panel.6",
          color: "text.app",
        },
        bg: "transparent",
        border: "1px solid",
        borderColor: "color.gray.4",
        shadow: "xs",
      },
    },
  },
})

type SidebarMenuButtonVariants = RecipeVariantProps<typeof sidebarMenuButtonStyles>

const StyledMenuButton = styled("button", sidebarMenuButtonStyles)
const StyledSlot = styled(Slot.Root, sidebarMenuButtonStyles)

export type SidebarMenuButtonProps = React.ComponentProps<"button"> &
  SidebarMenuButtonVariants &
  JsxStyleProps & {
    asChild?: boolean
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  }

const collapsedButtonStyles = css({
  "[data-collapsible=icon] &": {
    "& > span:last-child": {
      display: "none",
    },
    "& svg": {
      h: "3.5",
      w: "3.5",
    },
    "&[data-size=lg]": {
      p: "0",
    },
    "&[data-size=sm]": {
      h: "7",
      p: "1.5",
      w: "7",
    },
    h: "7",
    mx: "auto",
    p: "2",
    w: "8",
  },
})

const menuButtonWithActionStyles = css({
  "[data-slot=sidebar-menu-item]:has([data-slot=sidebar-menu-action]) &": {
    pr: "8",
  },
})

export const SidebarMenuButton = ({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: SidebarMenuButtonProps) => {
  const { isMobile, state } = useSidebar()

  const Component = asChild ? StyledSlot : StyledMenuButton

  const button = (
    <Component
      className={cx(collapsedButtonStyles, menuButtonWithActionStyles, className)}
      data-active={isActive}
      data-size={size}
      data-slot="sidebar-menu-button"
      size={size}
      type={asChild ? undefined : "button"}
      variant={variant}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  const tooltipProps = typeof tooltip === "string" ? { children: tooltip } : tooltip

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        align="center"
        hidden={state !== "collapsed" || isMobile}
        side="right"
        {...tooltipProps}
      />
    </Tooltip>
  )
}
