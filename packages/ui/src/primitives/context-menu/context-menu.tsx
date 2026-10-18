import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

export const ContextMenu = ({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) => {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}
