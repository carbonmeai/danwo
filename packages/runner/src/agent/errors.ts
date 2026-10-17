/** Why an agent step could not run. */
import { DanwoError } from "../support/codes.ts"

/** The agent could not finish the step: it gave up, looped, or ran out of budget. */
export class AgentStepFailed extends DanwoError {
  constructor(
    message: string,
    code: "AGENT_STEP_FAILED" | "AGENT_LOOPING" | "BUDGET_EXCEEDED" = "AGENT_STEP_FAILED",
  ) {
    super(code, message)
    this.name = "AgentStepFailed"
  }
}

/** A step had nothing recorded under strict replay. */
export class NothingRecorded extends DanwoError {
  constructor(step: number, instruction: string) {
    super(
      "NOTHING_RECORDED",
      `nothing recorded to replay for step ${step} ("${instruction}"). Record it first, and confirm the recording with a check after the step.`,
    )
    this.name = "NothingRecorded"
  }
}

/** Under strict replay, the step's recording was made under another key, so it was not used. */
export class StaleRecording extends DanwoError {
  readonly changed: readonly string[]

  constructor(step: number, instruction: string, changed: readonly string[]) {
    super(
      "STALE_RECORDING",
      `the recording of step ${step} ("${instruction}") is stale: its ${changed.join(", ")} changed since it was recorded. Record it again.`,
    )
    this.name = "StaleRecording"
    this.changed = changed
  }
}
