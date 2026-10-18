import type { FlexProps } from "@danwo/ui/jsx"

import { Flex } from "../layout"

export const AlertDialogHeader = (props: FlexProps) => {
  return <Flex data-slot="alert-dialog-header" {...props} />
}
