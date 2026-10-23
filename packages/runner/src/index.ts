// Runner: browser sessions driven like a user: locators, assertions and the agent.
export {
  BROWSER_NAMES,
  clickClosing,
  type BrowserConfig,
  browserInstalled,
  type BrowserName,
  browserNames,
  type BrowserProxy,
  type ContextOptions,
  INSTALL_BROWSER_COMMAND,
  installBrowser,
  type InstallBrowserOptions,
  installCommand,
  launchBrowser,
  type LaunchOptions,
  playwrightOptions,
  proxyContextOptions,
  proxyLaunchOptions,
} from "./browser/index.ts"
export {
  type EffectsSetting,
  openWebSession,
  type ReplayDivergence,
  type WebSession,
  type WebSessionOptions,
} from "./session.ts"
export { unique } from "./replay/index.ts"
export { likeness } from "./replay/relocate.ts"
export { redactCredentials, SecretVault } from "./secrets/index.ts"
