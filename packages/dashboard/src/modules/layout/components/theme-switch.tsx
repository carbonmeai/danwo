import { Icons } from "@danwo/ui/icons/base"
import { Button } from "@danwo/ui/primitives/button"
import { useTheme } from "@danwo/ui/primitives/theme"
import { useEffect, useState } from "react"

/**
 * Switches between the light and dark themes, as the library's icon button. The theme is only
 * known in the browser, so the button names the light theme until the page has hydrated, and the
 * server and the first browser render agree.
 */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const next = mounted && resolvedTheme === "dark" ? "light" : "dark"

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
