import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Dialog as SheetPrimitive } from "radix-ui"
import { type ComponentProps } from "react"

import { VisuallyHidden } from "../visually-hidden"
import { SheetDescription } from "./sheet-description"
import { SheetOverlay } from "./sheet-overlay"
import { SheetPortal } from "./sheet-portal"

const sheetStyles = cva({
  base: {
    _dark: {
      outline: "2px solid {colors.palette.gray.4}",
    },
    _light: {
      bg: "white",
      glass: "none",
    },
    bg: "background.popover",
    border: "subtle",
    glass: "popup",
    m: "8px",
    overflow: "hidden",
    pos: "fixed",
    roundedLeft: "xl",
    roundedRight: "xl",
    shadow: "sLg",
    w: "100%",
    zIndex: "100",
  },
  defaultVariants: {
    side: "bottomRight",
  },
  variants: {
    side: {
      bottomLeft: {
        "&[data-state=closed]": {
          animation: "slideOutLeft",
        },
        "&[data-state=open]": {
          animation: "slideInLeft",
        },
        bottom: "0",
        h: "calc(100vh - 16px)", // 16px is twice the margin
        left: "0",
        w: "1/4",
      },
      bottomRight: {
        "&[data-state=closed]": {
          animation: "slideOutRight",
        },
        "&[data-state=open]": {
          animation: "slideInRight",
        },
        bottom: "0",
        h: "calc(100vh - 16px)", // 16px is twice the margin
        right: "0",
      },
      left: {
        "&[data-state=closed]": {
          animation: "slideOutLeft",
        },
        "&[data-state=open]": {
          animation: "slideInLeft",
        },
        bottom: "0",
        h: "calc(100vh - 16px)",
        left: "0",
        w: "auto",
      },
      right: {
        "&[data-state=closed]": {
          animation: "slideOutRight",
        },
        "&[data-state=open]": {
          animation: "slideInRight",
        },
        bottom: "0",
        h: "calc(100vh - 16px)",
        right: "0",
        w: "auto",
      },
      topLeft: {
        "&[data-state=closed]": {
          animation: "slideOutLeft",
        },
        "&[data-state=open]": {
          animation: "slideInLeft",
        },
        h: "calc(100vh - 16px)", // 16px is twice the margin
        left: "0",
        top: "0",
        w: "1/4",
      },
      topRight: {
        "&[data-state=closed]": {
          animation: "slideOutRight",
        },
        "&[data-state=open]": {
          animation: "slideInRight",
        },
        h: "calc(100vh - 16px)", // 16px is twice the margin
        right: "0",
        top: "0",
      },
    },
  },
})

type SheetVariants = RecipeVariantProps<typeof sheetStyles>

type SheetContentProps = SheetVariants &
  ComponentProps<typeof SheetPrimitive.Content> &
  JsxStyleProps

const StyledSheetContent = styled(SheetPrimitive.Content, sheetStyles)

export const SheetContent = ({ children, style, ...props }: SheetContentProps) => {
  return (
    <SheetPortal>
      <SheetOverlay />
      <StyledSheetContent
        aria-describedby="dialog-content"
        style={{
          ...style,
        }}
        {...props}
      >
        <VisuallyHidden>
          <SheetDescription>Dialog content</SheetDescription>
        </VisuallyHidden>

        {children}
      </StyledSheetContent>
    </SheetPortal>
  )
}
