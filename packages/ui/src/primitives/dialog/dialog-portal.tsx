import { Dialog as DialogPrimitive } from "radix-ui"

export const DialogPortal = ({ ...props }: DialogPrimitive.DialogPortalProps) => (
  <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
)
