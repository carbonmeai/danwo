/**
 * Writing danwo tests: finding locators the way a test writes them, and writing new test files.
 */
export {
  locate,
  locatorCode,
  parseLocator,
  type QueryKind,
  type ScreenQuery,
  type TextMatch,
} from "./locators.ts"
export { isAriaRole, type AriaRole } from "./roles.ts"
export {
  type ImportLine,
  type InvariantDraft,
  renderTest,
  type TestFile,
  writeNewTest,
} from "./writer.ts"
