import { css, cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import * as React from "react"

import { Icons } from "../../icons/base"
import { Span } from "../typography"

type Props = React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & JsxStyleProps

const radioItemStyles = cva({
  base: {
    _disabled: {
      cursor: "not-allowed",
      opacity: 0.5,
      pointerEvents: "none",
    },

    "&[data-highlighted]": {
      bg: "background.muted",
    },
    alignItems: "center",
    cursor: "pointer",
    display: "flex",
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

const StyledRadio = styled(DropdownMenuPrimitive.RadioItem, radioItemStyles)

export const DropdownMenuRadioItem = ({ children, className, ...props }: Props) => {
  return (
    <StyledRadio {...props} className={className}>
      <React.Fragment>
        {children}

        <Span
          alignItems="center"
          display="flex"
          h="1.3rem"
          justifyContent="center"
          pos="absolute"
          right="8px"
          w="1.3rem"
        >
          <DropdownMenuPrimitive.ItemIndicator
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
          </DropdownMenuPrimitive.ItemIndicator>
        </Span>
      </React.Fragment>
    </StyledRadio>
  )
}
