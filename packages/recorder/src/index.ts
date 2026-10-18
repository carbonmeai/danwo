/**
 * Writing danwo tests: by recording someone using the app (`danwo record`), or from a description
 * (MCP's `scaffold_test`). Both find locators the same way and write files with the same writer.
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
export { type FinishOptions, type RecordedTest, recordedReport } from "./finish.ts"
export { type RecordOptions, Recording, startRecording } from "./recording.ts"
export { type SecretUse, secretName } from "./step-writer.ts"
export { draftInvariant, type DraftFacts, type InvariantPlan } from "./invariants.ts"
