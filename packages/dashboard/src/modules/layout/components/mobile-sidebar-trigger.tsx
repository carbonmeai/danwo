import { SidebarTrigger, useSidebar } from "@danwo/ui/primitives/sidebar"

/**
 * Below the mobile breakpoint the sidebar can be a closed drawer whose own trigger is inside it,
 * so nothing on screen could open it. This one floats over the page only then.
 */
export function MobileSidebarTrigger() {
  const { isMobile, openMobile } = useSidebar()

  if (!isMobile || openMobile) return null

  return (
    <SidebarTrigger
      position="fixed"
      top="2"
      left="2"
      zIndex="40"
      h="8"
      w="8"
      p="0"
      rounded="md"
      bg="surface.pop"
      boxShadow="pop"
    />
  )
}
