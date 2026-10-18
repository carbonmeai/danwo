import { useState } from "react"

import { Icons } from "../../icons/base"
import { RadioGroup, RadioGroupItem } from "../radio-group"
import { Span } from "../text"

const STARS = [1, 2, 3, 4, 5]

type Props = {
  disabled?: boolean
  value: string
  onValueChange: (value: string) => void
}

export const StarRating = ({ disabled, value, onValueChange }: Props) => {
  const [hoverValue, setHoverValue] = useState(0)

  const starCount = Number(value)

  return (
    <RadioGroup display="flex" onValueChange={onValueChange} value={value}>
      {STARS.map((star) => {
        const isActive = starCount >= star || hoverValue >= star

        return (
          <RadioGroupItem
            disabled={disabled}
            h="8"
            key={star}
            onMouseEnter={() => setHoverValue(star)}
            onMouseLeave={() => setHoverValue(0)}
            value={String(star)}
            w="8"
          >
            <Span _hover={{ opacity: "0.8" }} color={isActive ? "brand.primary.9" : "text.muted"}>
              <Icons.star
                css={{
                  fill: isActive ? "brand.primary.9" : "none",
                }}
              />
            </Span>
          </RadioGroupItem>
        )
      })}
    </RadioGroup>
  )
}
