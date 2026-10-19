import { Icons } from "@danwo/ui/icons/base"
import { styled } from "@danwo/ui/jsx"
import { useTheme } from "@danwo/ui/primitives/theme"

/** Switches between the light and dark themes, as a 28px icon button. */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === "dark" ? "light" : "dark"

  return (
    <styled.button
      type="button"
      display="inline-grid"
      placeItems="center"
      w="7"
      h="7"
      flexShrink="0"
      rounded="lg"
      color="ink.muted"
      cursor="pointer"
      _hover={{ color: "ink.strong", bg: "surface.active" }}
      onClick={() => setTheme(next)}
      aria-label={`Use the ${next} theme`}
      title={`Use the ${next} theme`}
    >
      {next === "dark" ? <Icons.moon size={16} /> : <Icons.sun size={16} />}
    </styled.button>
  )
}
