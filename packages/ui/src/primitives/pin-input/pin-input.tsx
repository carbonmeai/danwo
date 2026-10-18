import { OTPInput, type SlotProps as OTPSlotProps } from "input-otp"

import { Box, Flex } from "../layout"
import { Span } from "../text"

type PinInputProps = {
  numInputs?: number
  placeholder?: string
  isInputSecure?: boolean
  value: string
  onChange: (val: string) => void
  onSubmit?: (val: string) => void
}

type SlotItemProps = OTPSlotProps & {
  placeholder?: string
  isInputSecure?: boolean
  index: number
}

const Slot = ({
  char,
  hasFakeCaret,
  isActive,
  placeholder,
  isInputSecure,
  index,
}: SlotItemProps) => {
  const display = char != null ? (isInputSecure ? "•" : char) : null
  const placeholderChar = placeholder?.[index]

  return (
    <Flex
      align="center"
      bg="fg.6"
      border={isActive ? "1.5px solid token(colors.primary)" : "subtle"}
      data-active={isActive ? "true" : "false"}
      flex="1"
      fontSize="4"
      fontWeight="500"
      h="4.68rem"
      justify="center"
      maxW="4.68rem"
      outline="none"
      position="relative"
      rounded="lg"
      textAlign="center"
      transition="border-color 120ms ease"
      zIndex={isActive ? 1 : undefined}
    >
      {display ?? <Span color="text.placeholder">{placeholderChar}</Span>}
      {hasFakeCaret && (
        <Flex align="center" inset="0" justify="center" pointerEvents="none" position="absolute">
          <Box animation="caretBlink 1s step-end infinite" bg="fg.muted" h="1.5rem" w="0.0625rem" />
        </Flex>
      )}
    </Flex>
  )
}

export const PinInput = ({
  numInputs = 6,
  placeholder,
  isInputSecure,
  value,
  onChange,
  onSubmit,
}: PinInputProps) => {
  return (
    <OTPInput
      inputMode="numeric"
      maxLength={numInputs}
      onChange={onChange}
      onComplete={onSubmit}
      render={({ slots }) => {
        const slotItems = slots.map((slot, index) => ({
          id: `slot-${index}`,
          index,
          slot,
        }))

        return (
          <Flex
            align="center"
            css={{ "&:has(input:disabled)": { opacity: 0.5 } }}
            gap="3"
            justify="center"
            w="full"
          >
            {slotItems.map(({ id, index, slot }) => (
              <Slot
                {...slot}
                index={index}
                isInputSecure={isInputSecure}
                key={id}
                placeholder={placeholder}
              />
            ))}
          </Flex>
        )
      }}
      value={value}
    />
  )
}
