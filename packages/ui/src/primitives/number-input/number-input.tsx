import React from "react"
import { NumericFormat, type NumericFormatProps } from "react-number-format"

import { Input, type InputProps } from "../input"

type Props = NumericFormatProps & {
  inputProps?: InputProps
}

/**
 * NumericFormat types customInput against a plain input, so the wrapper takes
 * those props and forwards them into our Input rather than being cast.
 */
const CustomInputComponent = React.memo(function CustomInputComponent({
  inputProps,
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & { inputProps?: InputProps }) {
  return <Input {...props} {...inputProps} />
})

export const NumberInput = React.forwardRef<HTMLInputElement, Props>(
  function NumberInput(props, ref) {
    const { inputProps, ...rest } = props

    return (
      <NumericFormat
        {...rest}
        customInput={CustomInputComponent}
        getInputRef={ref}
        inputProps={inputProps}
        thousandSeparator
      />
    )
  },
)
