import type { DataKey, Store } from "../store.ts"
import type { CallRow, LlmPrice, ScriptRow } from "./entities.ts"

/** How the emulator answers a call no script matches. */
export type Unscripted = "echo" | "fail"

/** Settings that are plain data, kept in the store so a snapshot carries them. */
export interface LlmSettings {
  readonly unscripted: Unscripted
  readonly prices: Readonly<Record<string, LlmPrice>>
  readonly models: readonly string[]
}

export const SETTINGS: DataKey<LlmSettings> = { name: "llm.settings" }

/** Models listed when a seed names none. */
export const DEFAULT_MODELS = [
  "gpt-5-mini",
  "gpt-4o-mini",
  "text-embedding-3-small",
  "claude-sonnet-5",
  "claude-haiku-4-5",
]

/** The scripts and the calls the emulator answered, held in its store. */
export function llmStore(store: Store) {
  return {
    scripts: store.collection<ScriptRow>("llm.scripts"),
    calls: store.collection<CallRow>("llm.calls"),
    settings: (): LlmSettings =>
      store.getData(SETTINGS) ?? { unscripted: "echo", prices: {}, models: DEFAULT_MODELS },
  }
}

export type LlmStore = ReturnType<typeof llmStore>
