import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

export const ContextMenuPortal = ({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) => {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
}
