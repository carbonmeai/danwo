import { useIsMobile } from "@danwo/ui/hooks/use-mobile"
import { Box, styled } from "@danwo/ui/jsx"
import { SidebarInset, SidebarProvider } from "@danwo/ui/primitives/sidebar"
import { type ReactNode, useEffect, useState } from "react"

import { AppSidebar } from "./app-sidebar.tsx"
import { MobileSidebarTrigger } from "./mobile-sidebar-trigger.tsx"

/** Where the sidebar's open or collapsed state is kept between visits, in this browser only. */
const SIDEBAR_KEY = "danwo.sidebar"

function storedOpen(): boolean | undefined {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_KEY)

    return stored === null ? undefined : stored === "open"
  } catch {
    return undefined
  }
}

function storeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, open ? "open" : "collapsed")
  } catch {
    // Storage can be blocked; the sidebar then just opens expanded next time.
  }
}

/**
 * The sidebar's state: expanded unless this browser collapsed it last time, and always the icon
 * rail on a phone, where the page needs the width.
 */
function useSidebarOpen(): readonly [boolean, (open: boolean) => void] {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (isMobile) setOpen(false)
    else setOpen(storedOpen() ?? true)
  }, [isMobile])

  return [
    open,
    (next: boolean) => {
      setOpen(next)
      if (!isMobile) storeOpen(next)
    },
  ]
}

/** The app: the sidebar on the left, and the page beside it, the full width of the window. */
export function AppShell({
  project,
  children,
}: {
  readonly project: string
  readonly children: ReactNode
}) {
  const [open, setOpen] = useSidebarOpen()

  return (
    <SidebarProvider mobile="rail" open={open} onOpenChange={setOpen}>
      <styled.a
        href="#main"
        position="absolute"
        left="-9999px"
        _focus={{
          left: "4",
          top: "2",
          zIndex: "50",
          bg: "surface.pop",
          boxShadow: "pop",
          px: "3",
          py: "1.5",
          rounded: "lg",
        }}
      >
        Skip to content
      </styled.a>
      <Box display="flex" minH="100dvh" w="full">
        <AppSidebar project={project} />
        <MobileSidebarTrigger />
        <SidebarInset id="main">{children}</SidebarInset>
      </Box>
    </SidebarProvider>
  )
}
