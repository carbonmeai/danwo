import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import type * as React from "react"

export const AlertDialogAction = ({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) => {
  return <AlertDialogPrimitive.Action {...props} />
}
