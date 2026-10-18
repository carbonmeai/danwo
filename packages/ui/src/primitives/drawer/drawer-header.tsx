import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { HTMLStyledProps } from "@danwo/ui/types"

const headerStyles = cva({
  base: {
    ".group\\/drawer-content[data-vaul-drawer-direction=bottom] &": {
      textAlign: "center",
    },
    ".group\\/drawer-content[data-vaul-drawer-direction=top] &": {
      textAlign: "center",
    },
    alignItems: "center",
    display: "flex",
    flexDirection: "column",
    gap: "0.5",
    justifyContent: "center",
    px: "4",
    py: "4",
  },
})

const StyledHeader = styled("div", headerStyles)

export const DrawerHeader = (props: HTMLStyledProps<"div">) => {
  return <StyledHeader data-slot="drawer-header" {...props} />
}
