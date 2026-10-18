import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

export const ContextMenuSub = ({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) => {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}
