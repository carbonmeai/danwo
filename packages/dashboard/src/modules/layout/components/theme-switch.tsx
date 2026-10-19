import { Icons } from "@danwo/ui/icons/base"
import { Button } from "@danwo/ui/primitives/button"
import { useTheme } from "@danwo/ui/primitives/theme"

/** Switches between the light and dark themes, as the library's icon button. */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === "dark" ? "light" : "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      flexShrink="0"
      color="ink.muted"
      onClick={() => setTheme(next)}
      aria-label={`Use the ${next} theme`}
      tooltipChildren={`Use the ${next} theme`}
    >
      {next === "dark" ? <Icons.moon size={16} /> : <Icons.sun size={16} />}
    </Button>
  )
}
