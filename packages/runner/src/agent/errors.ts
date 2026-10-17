/** Why an agent step could not run. */

/** A step had nothing recorded under strict replay. */
export class NothingRecorded extends Error {
  constructor(step: number, instruction: string) {
    super(
      `nothing recorded to replay for step ${step} ("${instruction}"). Record it first, and confirm the recording with a check after the step.`,
    )
    this.name = "NothingRecorded"
  }
}
