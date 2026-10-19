/**
 * Model APIs as a service: the app's calls to OpenAI, Anthropic, the Vercel AI Gateway, Gemini,
 * Perplexity and Bedrock are answered from scripts by the model API emulator. Only the app's traffic goes through the proxy;
 * danwo's own agent calls its model directly from the runner, so it is never answered here.
 */
import { LLM_HOSTS, llm, type LlmSeedConfig, seedLlm } from "@danwo/emulators"

import {
  type OAuthEnvironment,
  oauthEnvironment,
  type OAuthService,
  oauthService,
  type Provider,
  type Seed,
} from "./oauth.ts"

/** Options of `llmService()` and `llmEnvironment()`. */
export interface LlmOptions {
  /** Scripts, prices, the models listed, how unscripted calls are answered, and recording. */
  readonly seed?: Seed<LlmSeedConfig>
}

/** What `llmEnvironment()` starts: the model API emulator behind its own proxy. */
export type LlmEnvironment = OAuthEnvironment<"llm">

const LLM: Provider<LlmSeedConfig> = {
  name: "llm",
  definition: llm,
  hosts: LLM_HOSTS,
  apply: (emulator, config) => seedLlm(emulator.store, config),
}

/**
 * Model APIs for `startServices`: `api.openai.com`, `api.anthropic.com`, `ai-gateway.vercel.sh`,
 * `generativelanguage.googleapis.com`, `api.perplexity.ai` and `bedrock-runtime.<region>.amazonaws.com`
 * answered from the seed's scripts, streamed when asked; gives tests the `llm` fixture. Read the
 * calls back with `llmCalls(llm)` and add scripts with `llmScripts(llm)`.
 */
export function llmService(options: LlmOptions = {}): OAuthService {
  return oauthService(LLM, options.seed ?? {})
}

/** A worker-scoped model API emulator behind its own proxy; combine services with `startServices`. */
export function llmEnvironment(
  options: LlmOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<LlmEnvironment> {
  return oauthEnvironment("llm", llmService(options), options)
}
