import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@danwo/ui/primitives/select"

import { ControlBone } from "./skeleton.tsx"

/** A choice still loading, as wide as the dropdown it stands in for. */
export function ChoiceSkeleton({ width = "11rem" }: { readonly width?: string }) {
  return <ControlBone w={width} />
}

/** The value a choice reads as when nothing narrower is picked. */
export const ANY = "any"

/**
 * One of a filter bar's dropdowns: the library's select, its options as `[value, words]` pairs.
 * `ANY` stands for no filter, since a select's options cannot be empty.
 */
export function Choice({
  label,
  value,
  options,
  onChange,
  width = "11rem",
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onChange: (value: string) => void
  readonly width?: string
}) {
  const shown = options.find(([key]) => key === value)?.[1] ?? options[0]?.[1]

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" w={width} aria-label={label}>
        <SelectValue>{shown}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, words]) => (
          <SelectItem key={key} value={key} size="sm">
            {words}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
