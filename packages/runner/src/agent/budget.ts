/**
 * Limits on what the agent may spend: per step and per test, in turns, model calls, dollars and
 * wall time. A step that goes over stops with `BUDGET_EXCEEDED`; so does every later agent step of
 * a test whose budget is spent.
 */
import type { CallCost } from "../model/resolve.ts"
import { AgentStepFailed } from "./errors.ts"

/** What may be spent; an absent limit is no limit. */
export interface Budget {
  /** Rounds of model call and actions in one step (only steps count turns). */
  readonly turns?: number
  readonly modelCalls?: number
  /** In US dollars, as the gateway bills it; calls with no reported cost count as free. */
  readonly costUsd?: number
  /** Wall time in milliseconds. */
  readonly ms?: number
}

/** A step's and a test's budget. */
export interface Budgets {
  readonly step?: Budget
  readonly test?: Budget
}

/** A step's limits when nothing else is set. */
export const DEFAULT_STEP_BUDGET: Budget = { turns: 25 }

/** What has been spent against one budget so far. */
export class Spend {
  private calls = 0
  private usd = 0
  private turnCount = 0
  private readonly started = Date.now()
  private readonly budget: Budget
  private readonly what: string

  constructor(budget: Budget, what: string) {
    this.budget = budget
    this.what = what
  }

  /** Counts one model call. */
  call(cost: CallCost): void {
    this.calls++
    this.usd += cost.costUsd ?? 0
  }

  /** Counts one turn of the step's loop. */
  turn(): void {
    this.turnCount++
  }

  /** Which limit is used up, if one is. */
  private exhausted(): string | undefined {
    const { turns, modelCalls, costUsd, ms } = this.budget

    if (turns !== undefined && this.turnCount >= turns) return `${turns} turns`
    if (modelCalls !== undefined && this.calls >= modelCalls) return `${modelCalls} model calls`
    if (costUsd !== undefined && this.usd >= costUsd) return `$${costUsd}`
    if (ms !== undefined && Date.now() - this.started >= ms) return `${ms} ms`

    return undefined
  }

  /** Throws `BUDGET_EXCEEDED` when a limit is used up. */
  check(): void {
    const limit = this.exhausted()

    if (limit !== undefined)
      throw new AgentStepFailed(
        `the ${this.what} used up its budget of ${limit}`,
        "BUDGET_EXCEEDED",
      )
  }
}

/** Both of a step's spends: its own and its test's. */
export class Spends {
  readonly step: Spend
  readonly test: Spend

  constructor(step: Spend, test: Spend) {
    this.step = step
    this.test = test
  }

  call(cost: CallCost): void {
    this.step.call(cost)
    this.test.call(cost)
  }

  check(): void {
    this.test.check()
    this.step.check()
  }
}
