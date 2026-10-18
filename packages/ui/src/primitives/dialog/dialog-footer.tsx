import { Flex, type FlexProps } from "@danwo/ui/jsx"

export const DialogFooter = ({ ...props }: FlexProps) => {
  return (
    <Flex
      borderTop="subtle"
      data-slot="dialog-footer"
      gap="3"
      // glass="popup"
      justify="flex-end"
      overflow="hidden"
      px="4"
      py="3"
      w="full"
      {...props}
    />
  )
}
