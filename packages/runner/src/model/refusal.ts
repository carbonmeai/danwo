/**
 * A model that declined to answer. Providers report a refusal, or an answer their content filter
 * stopped, as the finish reason `content-filter`. Asking again gets the same answer at the same
 * cost, so danwo stops at the first one with `MODEL_REFUSED`, which names the step and the model
 * and says nothing about the app.
 */
import type { LanguageModel } from "ai"

import { DanwoError } from "../support/codes.ts"

/** The finish reason the AI SDK gives a refusal and a filtered answer alike. */
const REFUSED = "content-filter"

/** How a model call finished, as the AI SDK reports it on a result or a tool-choice error. */
export interface Finish {
  readonly finishReason?: unknown
  readonly rawFinishReason?: unknown
}

/** The model as an error message names it: its provider and id, when it has them. */
function modelName(model: LanguageModel): string {
  if (typeof model === "string") return model

  return model.provider === "" ? model.modelId : `${model.provider}/${model.modelId}`
}

/** The model declined the step, or its provider's content filter stopped the answer. */
class ModelRefused extends DanwoError {
  constructor(what: string, model: LanguageModel, raw: unknown) {
    const why = typeof raw === "string" && raw !== REFUSED ? ` (the provider said "${raw}")` : ""

    super(
      "MODEL_REFUSED",
      `the model ${modelName(model)} refused ${what}${why}, so danwo did not ask again. Reword the step, or run it on another model.`,
    )
    this.name = "ModelRefused"
  }
}

/** Throws `ModelRefused` when `finish` says the model refused; `what` names the step. */
export function throwIfRefused(finish: Finish, what: string, model: LanguageModel): void {
  if (finish.finishReason === REFUSED) throw new ModelRefused(what, model, finish.rawFinishReason)
}

/**
 * `error` as a refusal, when it is the AI SDK's answer to a refusal: a tool call was required and
 * the model, refusing, made none. Anything else comes back as it was.
 */
export function refusalOr(error: unknown, what: string, model: LanguageModel): unknown {
  if (!(error instanceof Error) || error.name !== "AI_ToolChoiceViolationError") return error

  const finish = Reflect.get(error, "finishReason")

  return finish === REFUSED ? new ModelRefused(what, model, undefined) : error
}
