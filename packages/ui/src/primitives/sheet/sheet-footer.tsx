import { Flex, type FlexProps } from "@danwo/ui/jsx"

export const SheetFooter = ({ ...props }: FlexProps) => {
  return (
    <Flex
      gap="3"
      // glass="popup"
      justify="flex-end"
      px="4"
      py="3"
      w="full"
      {...props}
    />
  )
}
