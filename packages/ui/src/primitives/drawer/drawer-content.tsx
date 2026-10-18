import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type { ComponentProps } from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { VisuallyHidden } from "../visually-hidden"
import { DrawerDescription } from "./drawer-description"
import { DrawerOverlay } from "./drawer-overlay"
import { DrawerPortal } from "./drawer-portal"

const drawerContentStyles = cva({
  base: {
    _dark: {
      outline: "2px solid {colors.palette.gray.4}",
    },
    _light: {
      bg: "white",
    },
    "&[data-vaul-drawer-direction=bottom]": {
      borderColor: "border.subtle",
      borderTopWidth: "1px",
      bottom: "0",
      insetX: "0",
      maxH: "80vh",
      mt: "24",
      roundedTop: "xl",
    },
    "&[data-vaul-drawer-direction=left]": {
      borderColor: "border.subtle",
      borderRightWidth: "1px",
      h: "100%",
      insetY: "0",
      left: "0",
      roundedRight: "xl",
      sm: {
        maxW: "sm",
      },
      w: "75%",
    },
    "&[data-vaul-drawer-direction=right]": {
      borderColor: "border.subtle",
      borderLeftWidth: "1px",
      h: "100%",
      insetY: "0",
      right: "0",
      roundedLeft: "xl",
      sm: {
        maxW: "sm",
      },
      w: "75%",
    },
    "&[data-vaul-drawer-direction=top]": {
      borderBottomWidth: "1px",
      borderColor: "border.subtle",
      insetX: "0",
      maxH: "80vh",
      mb: "24",
      roundedBottom: "xl",
      top: "0",
    },
    bg: "background.popover",
    display: "flex",
    flexDirection: "column",
    fontSize: "sm",
    h: "auto",
    overflow: "hidden",
    pos: "fixed",
    zIndex: "100",
  },
})

const handleStyles = cva({
  base: {
    ".group\\/drawer-content[data-vaul-drawer-direction=bottom] &": {
      display: "block",
    },
    bg: "background.muted",
    display: "none",
    flexShrink: "0",
    h: "1",
    mt: "4",
    mx: "auto",
    rounded: "full",
    w: "100px",
  },
})

type DrawerContentProps = ComponentProps<typeof DrawerPrimitive.Content> & JsxStyleProps

const StyledDrawerContent = styled(DrawerPrimitive.Content, drawerContentStyles)
const DrawerHandle = styled("div", handleStyles)

export const DrawerContent = ({ children, style, ...props }: DrawerContentProps) => {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <StyledDrawerContent
        aria-describedby="drawer-content"
        className="group/drawer-content"
        data-slot="drawer-content"
        style={{
          ...style,
        }}
        {...props}
      >
        <VisuallyHidden>
          <DrawerDescription>Drawer content</DrawerDescription>
        </VisuallyHidden>

        <DrawerHandle />
        {children}
      </StyledDrawerContent>
    </DrawerPortal>
  )
}
