import * as React from "react"

import { Icons } from "../../icons/base"
import { Button } from "../button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../command"
import { Popover, PopoverContent, PopoverTrigger } from "../popover"
import { Span } from "../text"

type Props = {
  options: { value: string; label: string }[]
  placeholder?: string
  value: string[]
  setValue: (val: string[]) => void
  triggerClassname?: string
  contentClassname?: string
}

export function MultiSelectWithSearch({
  value,
  setValue,
  options,
  placeholder = "Search option...",
  triggerClassname,
  contentClassname,
}: Props) {
  const [selected, setSelected] = React.useState<Props["options"]>([])
  const [open, setOpen] = React.useState(false)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          _focus={{
            border: "focused",
          }}
          aria-expanded={open}
          border="subtle"
          className={triggerClassname}
          fontSize="1"
          fontWeight="normal"
          h="3.6rem"
          justifyContent="space-between"
          variant="ghost"
          px="1.5"
          role="combobox"
          w="full"
        >
          <Span color={selected ? undefined : "text.placeholder"}>
            {selected.length > 0 ? `${selected.length} item(s)` : placeholder}
          </Span>

          <Icons.caretDown color="text.muted" ml="2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={contentClassname} p="0" w="full">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No option</CommandEmpty>
            {options.map((item) => (
              <CommandItem
                justifyContent="space-between"
                key={item.value}
                onSelect={() => {
                  setValue([...value, item.value])
                  setSelected([...selected, item])
                  setOpen(false)
                }}
              >
                {item.label}
                <Icons.check
                  h="1.6rem"
                  mr="2"
                  opacity={value.includes(item.value.toLowerCase()) ? "1" : "0"}
                  w="1.6rem"
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
