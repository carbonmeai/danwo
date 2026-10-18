import { Flex, type FlexProps } from "@danwo/ui/jsx"

export const DialogHeader = ({ ...props }: FlexProps) => {
  return (
    <Flex
      align="center"
      borderBottom="subtle"
      data-slot="dialog-header"
      // glass="popup"
      justify="space-between"
      overflow="hidden"
      px="4"
      py="3"
      roundedTopLeft="inherit"
      roundedTopRight="inherit"
      {...props}
    />
  )
}
