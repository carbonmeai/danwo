import { css, cx } from "@danwo/ui/css"
import { Box } from "@danwo/ui/jsx"
import { SEPARATORS, WithContext as ReactTags, type ReactTagsWrapperProps } from "react-tag-input"

import { inputStyles } from "../input"

type Tag = NonNullable<ReactTagsWrapperProps["tags"]>[number]

type Props = {
  value: string[]
  setValue: (val: string[]) => void
  suggestions?: Tag[]
  placeholder?: string
  labelField?: string
  autofocus?: boolean
  allowDeleteFromEmptyInput?: boolean
  autocomplete?: boolean
  allowDragDrop?: boolean
  allowUnique?: boolean
  minQueryLength?: number
  readOnly?: boolean
  inline?: boolean
  name?: string
  id?: string
  handleTagClick?: (index: number) => void
  handleInputChange?: (val: string) => void
  handleInputFocus?: (val: string) => void
  handleInputBlur?: (val: string) => void
  classNames?: {
    tags?: string
    tagInput?: string
    tagInputField?: string
    selected?: string
    tag?: string
    remove?: string
    suggestions?: string
    activeSuggestion?: string
    editTagInput?: string
    editTagInputField?: string
    clearAll?: string
  }
}

const separators = [SEPARATORS.COMMA, SEPARATORS.ENTER]

export const TagInput = ({ classNames, handleInputChange, value, setValue, ...props }: Props) => {
  const tags = value.map((item) => ({
    className: "",
    id: item,
    text: item,
  }))

  const handleDelete = (i: number) => {
    setValue(value.filter((_item, index) => index !== i))
  }

  const handleAddition = (tag: Tag) => {
    setValue([...value, tag.id])
  }

  const handleDrag = (_tag: Tag, currPos: number, newPos: number) => {
    const next = [...value]
    const [moved] = next.splice(currPos, 1)

    if (moved === undefined) return
    next.splice(newPos, 0, moved)
    setValue(next)
  }

  const handleTagClick = (/* index: number */) => {
    //
  }

  const handleInputBlur = (textInputValue: string) => {
    // Add the current text input value to the tags
    if (textInputValue.trim() !== "") {
      const newTag = {
        className: "",
        id: textInputValue,
        text: textInputValue,
      }

      handleAddition(newTag)
    }
  }

  return (
    <Box>
      <ReactTags
        autocomplete
        classNames={{
          activeSuggestion: cx(classNames?.activeSuggestion),
          clearAll: "",
          editTagInput: "",
          editTagInputField: "",
          remove: cx(
            css({
              _hover: {
                "& svg": {
                  fill: "text.error !important",
                },
              },

              "& svg": {
                fill: "text.app !important",
                h: "8px !important",
                w: "8px !important",
              },
              cursor: "pointer",
              fontSize: "1",
              ml: "1",
            }),
            classNames?.remove,
          ),
          selected: cx(classNames?.selected),
          suggestions: cx(classNames?.suggestions),
          tag: cx(
            css({
              alignItems: "center",
              bg: "background.muted",
              display: "inline-flex",
              fontSize: "1",
              justifyItems: "center",
              mb: "1",
              mr: "1",
              px: "1.5",
              rounded: "sm",
            }),
            classNames?.tag,
          ),
          tagInput: cx(classNames?.tagInput),
          tagInputField: cx(
            inputStyles({ size: "sm" }),
            css({
              "&::placeholder": {
                color: "text.placeholder",
              },
            }),
            classNames?.tagInputField,
          ),
          tags: cx(classNames?.tags),
        }}
        separators={separators}
        handleAddition={handleAddition}
        handleDelete={handleDelete}
        handleDrag={handleDrag}
        handleInputBlur={handleInputBlur}
        handleInputChange={handleInputChange}
        handleTagClick={handleTagClick}
        inputFieldPosition="inline"
        suggestions={[]}
        tags={tags}
        {...props}
      />
    </Box>
  )
}
