import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import type * as React from "react"

type Props = React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  inset?: boolean
} & JsxStyleProps

const contentStyles = cva({
  base: {
    _light: {
      bg: "background.popover",
      glass: "none",
    },
    "&[data-state=closed]": {
      animation: "popoverHide",
    },

    "&[data-state=open]": {
      animation: "popoverUpIn",
    },
    bg: "background.popover",
    border: "subtle",
    minW: "8rem",
    mx: "2.5",
    overflow: "hidden",
    p: "1",
    rounded: "xl",
    shadow: "sSm",
    transformOrigin: "top left",
    zIndex: "100",
  },
})

const StyledContent = styled(DropdownMenuPrimitive.Content, contentStyles)

export const DropdownMenuContent = ({
  sideOffset = 4,
  alignOffset = -10,
  style,
  ...props
}: Props) => {
  // const { resolvedTheme } = useTheme()

  /*
   * useEffect(() => {
   * 	if (resolvedTheme !== 'light') {
   * 		setBgGrain(DARK_BODY_GRAIN_PATH)
   * 	} else {
   * 		setBgGrain(undefined)
   * 	}
   * }, [resolvedTheme])
   */

  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal">
      <StyledContent
        alignOffset={alignOffset}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        style={{ ...style }}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}
