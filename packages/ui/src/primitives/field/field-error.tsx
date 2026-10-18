import { css, cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { useMemo } from "react"

const fieldErrorStyles = cva({
  base: {
    color: "text.error",
    fontSize: "2",
    fontWeight: "normal",
  },
})

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: "1",
  listStyle: "disc",
  ml: "4",
})

const StyledFieldError = styled("div", fieldErrorStyles)

export const FieldError = ({
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> &
  JsxStyleProps & {
    errors?: Array<{ message?: string } | undefined>
  }) => {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()]

    if (uniqueErrors?.length === 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className={listStyles}>
        {uniqueErrors.map(
          (error) => error?.message && <li key={error.message}>{error.message}</li>,
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <StyledFieldError data-slot="field-error" role="alert" {...props}>
      {content}
    </StyledFieldError>
  )
}
