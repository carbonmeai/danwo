import { css, cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import type React from "react"

import { Icons } from "../../icons/base"
import { Span } from "../typography"

type Props = React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & JsxStyleProps

const radioItemStyles = cva({
  base: {
    /*
     * _hover: {
     *   bg: 'background.muted'
     * },
     */

    _disabled: {
      cursor: "not-allowed",
      opacity: 0.5,
      pointerEvents: "none",
    },
    alignItems: "center",
    cursor: "pointer",
    display: "flex",
    /*
     * mx: '0.5rem',
     * my: '0.5rem',
     */
    fontSize: "1",
    outline: "none",
    pos: "relative",
    px: "0.5rem",
    py: "0.5rem",
    rounded: "8px",
    transition: "colors 200ms",
    userSelect: "none",
  },
})

const StyledRadio = styled(ContextMenuPrimitive.RadioItem, radioItemStyles)

export const ContextMenuRadioItem = ({ children, ...props }: Props) => {
  return (
    <StyledRadio data-slot="context-menu-radio-item" {...props}>
      <Span
        alignItems="center"
        display="flex"
        h="1.3rem"
        justifyContent="center"
        pos="absolute"
        right="8px"
        w="1.3rem"
      >
        <ContextMenuPrimitive.ItemIndicator
          className={css({
            alignItems: "center",
            bg: "brand.primary.9",
            borderRadius: "50%",
            display: "flex",
            justifyContent: "center",
            p: "10%",
          })}
        >
          <Icons.check color="white" size={12} />
        </ContextMenuPrimitive.ItemIndicator>
      </Span>
      {children}
    </StyledRadio>
  )
}
