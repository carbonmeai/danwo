import type * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

export const Drawer = ({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) => {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}
