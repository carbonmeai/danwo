import type { Store } from "../store.ts"
import type { LlmPrice } from "./entities.ts"
import { type LlmRecordOptions, startRecording } from "./record.ts"
import { addScripts, type LlmScript } from "./scripts.ts"
import { DEFAULT_MODELS, llmStore, SETTINGS, type Unscripted } from "./store.ts"

/** What the model API emulator starts with. */
export interface LlmSeedConfig {
  /** Scripted answers; the first that matches a call answers it. */
  readonly scripts?: readonly LlmScript[]
  /** A call no script answers gets its own words back, marked (`echo`), or a 500 (`fail`). */
  readonly unscripted?: Unscripted
  /** Dollars per million tokens, by model, for usage and gateway cost. */
  readonly prices?: Readonly<Record<string, LlmPrice>>
  /** The models `GET /v1/models` lists. */
  readonly models?: readonly string[]
  /** Records unscripted calls from the real provider with the user's own key, then replays them. */
  readonly record?: LlmRecordOptions
}

export function seedLlm(store: Store, config: LlmSeedConfig = {}): void {
  store.setData(SETTINGS, {
    unscripted: config.unscripted ?? "echo",
    prices: config.prices ?? {},
    models: config.models ?? DEFAULT_MODELS,
  })
  addScripts(llmStore(store), config.scripts ?? [])
  startRecording(store, config.record)
}
