import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

export const ContextMenuTrigger = ({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) => {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}
