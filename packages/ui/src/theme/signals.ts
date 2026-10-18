import { defineSemanticTokens } from "@pandacss/dev"

/**
 * The dashboard's own palette: a cool neutral ground, one cobalt accent for links and for what
 * happened behind the app, and one colour per verdict so a failure reads the same on every page.
 */
export const signalColors = defineSemanticTokens.colors({
  signal: {
    ground: { value: { base: "#f4f6f9", _dark: "#0f1318" } },
    panel: { value: { base: "#ffffff", _dark: "#161b22" } },
    raised: { value: { base: "#f9fafc", _dark: "#1b212a" } },
    ink: { value: { base: "#151a21", _dark: "#e6eaf0" } },
    quiet: { value: { base: "#5d6774", _dark: "#8c96a3" } },
    faint: { value: { base: "#8a94a1", _dark: "#5f6977" } },
    rule: { value: { base: "#e1e5eb", _dark: "#252c35" } },
    ruleStrong: { value: { base: "#cbd2db", _dark: "#343d48" } },
    accent: { value: { base: "#2c5bd8", _dark: "#7c9bff" } },
    accentSoft: { value: { base: "#e8eefc", _dark: "#1c2640" } },
    focus: { value: { base: "#2c5bd8", _dark: "#9db4ff" } },
  },
  verdict: {
    passed: {
      fg: { value: { base: "#167a45", _dark: "#57cf8f" } },
      bg: { value: { base: "#e3f4ea", _dark: "#12301f" } },
      solid: { value: { base: "#1f9254", _dark: "#3fb878" } },
    },
    failed: {
      fg: { value: { base: "#b72f31", _dark: "#ff7a7c" } },
      bg: { value: { base: "#fbe6e6", _dark: "#3a1618" } },
      solid: { value: { base: "#d23b3b", _dark: "#e5534f" } },
    },
    flaky: {
      fg: { value: { base: "#8f5d00", _dark: "#f0b24a" } },
      bg: { value: { base: "#fbf0d8", _dark: "#33260d" } },
      solid: { value: { base: "#c58600", _dark: "#d99a2b" } },
    },
    notJudged: {
      fg: { value: { base: "#5b3fc0", _dark: "#ac97ff" } },
      bg: { value: { base: "#ede8fd", _dark: "#251d45" } },
      solid: { value: { base: "#6b4fd0", _dark: "#8b72ec" } },
    },
    invalid: {
      fg: { value: { base: "#59626e", _dark: "#9aa3af" } },
      bg: { value: { base: "#eceff3", _dark: "#232931" } },
      solid: { value: { base: "#8a94a1", _dark: "#5f6977" } },
    },
  },
})
