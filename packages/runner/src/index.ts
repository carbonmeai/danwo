// Runner: browser sessions driven like a user: locators, assertions and the agent.
export { type BrowserProxy, launchBrowser, type LaunchOptions } from "./browser/index.ts"
export {
  openWebSession,
  type ReplayDivergence,
  type WebSession,
  type WebSessionOptions,
} from "./session.ts"
export { unique } from "./replay/index.ts"
export { likeness } from "./replay/relocate.ts"
export { redactCredentials, SecretVault } from "./secrets/index.ts"
