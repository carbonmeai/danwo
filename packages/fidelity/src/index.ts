/** Fidelity: checks that danwo's emulators answer like the providers they stand in for. */
export { fidelityCommand, type FidelityCommandOptions } from "./command.ts"
export { compareShapes, type Difference, type DifferenceKind } from "./compare.ts"
export {
  type Golden,
  type GoldenScenario,
  type KnownDifference,
  readGolden,
  readKnownDifferences,
  type StepDifference,
} from "./golden.ts"
export { type ApiDescription, readDescription } from "./openapi.ts"
export {
  type CredentialVariable,
  type FidelityProvider,
  fidelityEnvironment,
  LiveCredentialRefused,
} from "./provider.ts"
export { FIDELITY_PROVIDERS, providersNamed } from "./providers/index.ts"
export {
  type FidelityMode,
  type FidelityOptions,
  fidelityPassed,
  formatFidelity,
  type ProviderReport,
  runFidelity,
  type ScenarioReport,
} from "./run.ts"
export type {
  Fact,
  Observation,
  Scenario,
  ScenarioContext,
  ScenarioRun,
  Target,
} from "./scenario.ts"
export { type Shape, shapeOf } from "./shape.ts"
