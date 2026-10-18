import type { RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "radix-ui"
import type * as React from "react"

import { Icons } from "../../icons/base"
import { KeyboardShortcut } from "../keyboard-shortcut"
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip"
import type { TooltipContentProps } from "../tooltip/tooltip-content"
import { Span } from "../typography"
import { buttonStyle } from "./button-styles"

const StyledButton = styled("button", buttonStyle)

const StyledSlot = styled(Slot.Root, buttonStyle)

export type ButtonVariants = RecipeVariantProps<typeof buttonStyle>

export type ButtonProps = {
  isLoading?: boolean
  isDisabled?: boolean
  loadingText?: string
  tooltipContentProps?: TooltipContentProps
  tooltipChildren?: React.ReactNode
  shortcut?: React.ReactNode
  asChild?: boolean
} & React.ComponentProps<"button"> &
  ButtonVariants &
  JsxStyleProps

export const Button = ({
  isLoading,
  isDisabled,
  loadingText,
  children,
  tooltipChildren,
  tooltipContentProps,
  shortcut,
  asChild,
  ...props
}: ButtonProps) => {
  const tooltipContent = tooltipChildren || tooltipContentProps?.children

  const Component = asChild ? StyledSlot : StyledButton

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Component data-slot="button" disabled={isLoading || isDisabled} type="button" {...props}>
          {/* The slotted child must be the only child, so it becomes the button itself rather than sitting in a span. */}
          {asChild ? (
            children
          ) : !isLoading ? (
            <span data-slot="button-content">
              {children}
              {shortcut && <KeyboardShortcut size={props.size}>{shortcut}</KeyboardShortcut>}
            </span>
          ) : (
            <span data-slot="button-loading">
              {loadingText && <Span pr="1">{loadingText}</Span>}
              <Icons.loading animation="loader" />
            </span>
          )}
        </Component>
      </TooltipTrigger>
      {tooltipContent && (
        <TooltipContent align="start" {...tooltipContentProps}>
          {tooltipContent}
        </TooltipContent>
      )}
    </Tooltip>
  )
}
