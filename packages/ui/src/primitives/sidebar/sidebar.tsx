import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../sheet"
import { SIDEBAR_WIDTH_MOBILE } from "./sidebar-constants"
import { useSidebar } from "./sidebar-provider"

type SidebarProps = React.ComponentProps<"div"> &
  JsxStyleProps & {
    side?: "left" | "right"
    variant?: "sidebar" | "floating" | "inset"
    collapsible?: "offcanvas" | "icon" | "none"
  }

const sidebarWrapperStyles = css({
  color: "text.app",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  transitionDuration: "200ms",
  transitionProperty: "width",
  transitionTimingFunction: "linear",
})

const sidebarInnerStyles = css({
  bg: "background.sidebar",
  display: "flex",
  flexDirection: "column",
  h: "full",
  transitionDuration: "200ms",
  transitionProperty: "left, right, width",
  transitionTimingFunction: "linear",
  w: "var(--sidebar-width)",
})

const sidebarFixedStyles = css({
  position: "fixed",
  top: "0",
  zIndex: 10,
})

const sidebarBorderLeft = css({ borderRight: "subtle" })
const sidebarBorderRight = css({ borderLeft: "subtle" })

const sidebarFloatingInset = css({
  p: "2",
  position: "fixed",
  top: "0",
  zIndex: 10,
})

const sidebarFloatingInner = css({
  border: "1px solid",
  borderColor: "color.gray.4",
  overflow: "hidden",
  rounded: "lg",
  shadow: "sm",
})

const mobileSheetContent = css({
  "& [data-sidebar=sidebar]": {
    display: "flex",
    flexDirection: "column",
    h: "full",
    w: "full",
  },
  bg: "background.sidebar",
  p: "0",
  w: "var(--sidebar-width-mobile)",
})

export const Sidebar = ({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: SidebarProps) => {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        className={cx(
          css({
            bg: "background.sidebar",
            color: "text.app",
            display: "flex",
            flexDirection: "column",
            h: "full",
            w: "var(--sidebar-width)",
          }),
          className,
        )}
        data-slot="sidebar"
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpenMobile} open={openMobile}>
        <SheetContent
          className={cx(mobileSheetContent, className)}
          data-mobile="true"
          data-slot="sidebar"
          side={side}
          style={
            {
              "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
        >
          <SheetTitle srOnly>Sidebar</SheetTitle>
          <SheetDescription srOnly>Navigation sidebar</SheetDescription>
          <div data-sidebar="sidebar">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className={sidebarWrapperStyles}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-side={side}
      data-slot="sidebar"
      data-state={state}
      data-variant={variant}
      style={{
        width:
          state === "collapsed" && collapsible === "offcanvas"
            ? "0"
            : state === "collapsed" && collapsible === "icon"
              ? "var(--sidebar-width-icon)"
              : "var(--sidebar-width)",
      }}
    >
      {/* Gap element for layout */}
      <div
        className={css({
          bg: "transparent",
          position: "relative",
          transitionDuration: "200ms",
          transitionProperty: "width",
          transitionTimingFunction: "linear",
          w: "var(--sidebar-width)",
        })}
        style={{
          width:
            state === "collapsed" && collapsible === "offcanvas"
              ? "0"
              : state === "collapsed" && collapsible === "icon"
                ? "var(--sidebar-width-icon)"
                : "var(--sidebar-width)",
        }}
      />
      <div
        className={cx(
          sidebarInnerStyles,
          variant === "floating" || variant === "inset" ? sidebarFloatingInset : sidebarFixedStyles,
          variant === "floating" || variant === "inset"
            ? sidebarFloatingInner
            : side === "left"
              ? sidebarBorderLeft
              : sidebarBorderRight,
          className,
        )}
        data-side={side}
        data-sidebar="sidebar"
        data-state={state}
        data-variant={variant}
        style={{
          ...(side === "left" ? { left: "0" } : { right: "0" }),
          height: variant === "floating" || variant === "inset" ? "calc(100% - 1rem)" : "100%",
          overflow: state === "collapsed" && collapsible === "offcanvas" ? "hidden" : undefined,
          width:
            state === "collapsed" && collapsible === "offcanvas"
              ? "0"
              : state === "collapsed" && collapsible === "icon"
                ? "var(--sidebar-width-icon)"
                : "var(--sidebar-width)",
        }}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}
