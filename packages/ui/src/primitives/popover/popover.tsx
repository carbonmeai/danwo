import { Popover as PopoverPrimitive } from "radix-ui"

export const Popover = ({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) => {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}
