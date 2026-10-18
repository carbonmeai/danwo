import type { FlexProps } from "@danwo/ui/jsx"

import { Flex } from "../layout"

export const AlertDialogFooter = (props: FlexProps) => {
  return <Flex data-slot="alert-dialog-footer" {...props} />
}
