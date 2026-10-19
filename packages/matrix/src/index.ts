// Effect engine: runs, environments, fidelity tiers, oracles, verdicts.
export {
  applyFault,
  checkFaultFired,
  clearWebhookFaults,
  deliveriesOf,
  faultFired,
  type FaultMatrixOptions,
  type FaultMatrixResult,
  formatMatrix,
  type PlannedFault,
  planFaults,
  pollPositions,
  type RaceFault,
  type RunEnvironment,
  type RunOutcome,
  type RunWebhooks,
  routeOf,
  runFaultMatrix,
  type ServiceDelivery,
  webhookSources,
} from "./fault-matrix.ts"
export {
  applyDataFault,
  clearDataFaults,
  type DataFaultCatalogue,
  dataCallsOf,
  type DataPlannedFault,
  planDataFaults,
} from "./data-faults.ts"
export {
  applySocketFault,
  planSocketFaults,
  socketRoute,
  type SocketPlannedFault,
} from "./socket-faults.ts"
export {
  appRoute,
  planRaceFaults,
  type RaceCall,
  type RaceEvidence,
  type RacePlanOptions,
  type RaceReturn,
} from "./races.ts"
