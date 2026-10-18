import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { AlertDialogOverlay } from "./alert-dialog-overlay"
import { AlertDialogPortal } from "./alert-dialog-portal"

const StyledContent = styled(AlertDialogPrimitive.Content)

export const AlertDialogContent = ({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & JsxStyleProps) => {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <StyledContent
        bg="background.app"
        border="subtle"
        css={{
          "&[data-state=closed]": {
            animation: "fadeElementOut",
          },
          "&[data-state=open]": {
            animation: "fadeElementIn",
          },
        }}
        data-slot="alert-dialog-content"
        // glass="popup"
        left="50%"
        position="fixed"
        rounded="3xl"
        top="50%"
        transform="translate(-50%, -50%)"
        zIndex="100"
        {...props}
      />
    </AlertDialogPortal>
  )
}
