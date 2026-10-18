import { Dialog as SheetPrimitive } from "radix-ui"

export const SheetPortal = ({ ...props }: SheetPrimitive.DialogPortalProps) => (
  <SheetPrimitive.Portal {...props} />
)
