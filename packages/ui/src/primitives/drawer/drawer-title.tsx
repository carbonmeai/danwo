import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

type Props = React.ComponentProps<typeof DrawerPrimitive.Title> & JsxStyleProps

const titleStyles = cva({
  base: {
    alignItems: "center",
    display: "flex",
    gap: "1.5",
    textStyle: "modalTitle",
  },
})

const StyledDrawerTitle = styled(DrawerPrimitive.Title, titleStyles)

export const DrawerTitle = (props: Props) => {
  return <StyledDrawerTitle data-slot="drawer-title" {...props} />
}
