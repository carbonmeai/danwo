import type * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

export const DrawerPortal = ({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) => (
  <DrawerPrimitive.Portal {...props} />
)
