import { Box, type BoxProps } from "@danwo/ui/jsx"

export const DialogBody = ({ ...props }: BoxProps) => {
  return <Box data-slot="dialog-body" maxH="90vh" overflowY="scroll" px="4" py="3" {...props} />
}
