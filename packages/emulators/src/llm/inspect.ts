/** What tests read from and give to the model API emulator: the calls it answered, and scripts. */
import type { Emulator } from "../define.ts"
import type { Entity } from "../store.ts"
import type { CallRow } from "./entities.ts"
import { addScripts, type LlmScript } from "./scripts.ts"
import { llmStore } from "./store.ts"

/** One call an app made to a model, as it was answered. */
export type LlmCall = Omit<CallRow, keyof Entity>

function view(row: CallRow): LlmCall {
  const { id: _id, created_at: _created, updated_at: _updated, ...call } = row

  return call
}

/** The calls the app made, in order, with their messages (key-shaped values scrubbed). */
export interface LlmCalls {
  all(): LlmCall[]
  last(): LlmCall | undefined
  /** Total dollars across calls whose model has a price. */
  cost(): number
}

/** The calls the app made to OpenAI, Anthropic and the AI Gateway, oldest first. */
export function llmCalls(emulator: Emulator): LlmCalls {
  const llm = llmStore(emulator.store)
  const all = () =>
    llm.calls
      .all()
      .toSorted((a, b) => a.id - b.id)
      .map(view)

  return {
    all,
    last: () => all().at(-1),
    cost: () => all().reduce((total, call) => total + (call.cost ?? 0), 0),
  }
}

/** Adds scripts from a test, after the seeded ones; `clear` removes every script. */
export interface LlmScripts {
  add(...scripts: LlmScript[]): void
  clear(): void
}

/** Scripts a test adds to the model API emulator while it runs. */
export function llmScripts(emulator: Emulator): LlmScripts {
  const llm = llmStore(emulator.store)

  return {
    add: (...scripts) => addScripts(llm, scripts),
    clear: () => llm.scripts.clear(),
  }
}
