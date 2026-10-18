import { Combobox as ComboboxPrimitive } from "@base-ui/react"

export type ComboboxValueProps = ComboboxPrimitive.Value.Props

export const ComboboxValue = ({ ...props }: ComboboxValueProps) => {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}
