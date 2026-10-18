import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

import { InputGroup } from "../input-group/input-group"
import { InputGroupAddon } from "../input-group/input-group-addon"
import { InputGroupButton } from "../input-group/input-group-button"
import { InputGroupInput } from "../input-group/input-group-input"
import { ComboboxClear } from "./combobox-clear"
import { ComboboxTrigger } from "./combobox-trigger"

export type ComboboxInputProps = ComboboxPrimitive.Input.Props &
  JsxStyleProps & {
    showTrigger?: boolean
    showClear?: boolean
  }

const StyledComboboxInput = styled(ComboboxPrimitive.Input)

export const ComboboxInput = ({
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxInputProps) => {
  return (
    <InputGroup css={{ h: props.h, maxH: props.maxH, minH: props.minH, w: "auto" }}>
      <StyledComboboxInput
        maxH={props.maxH}
        minH={props.minH}
        render={
          <InputGroupInput
            disabled={disabled}
            h={props.h}
            resize={props.resize}
            rounded={props.rounded}
          />
        }
        {...props}
      />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <InputGroupButton
            asChild
            css={{
              ".group\\/input-group:has([data-slot=combobox-clear]) &": {
                display: "none",
              },
              "&[data-pressed]": {
                bg: "transparent",
              },
            }}
            disabled={disabled}
          >
            <ComboboxTrigger />
          </InputGroupButton>
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  )
}
