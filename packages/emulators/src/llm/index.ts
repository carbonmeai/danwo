import { defineEmulator } from "../define.ts"
import { providerErrors } from "../errors.ts"
import { llmAuth } from "./auth.ts"
import { llmError } from "./helpers.ts"
import { anthropicRoutes } from "./routes/anthropic.ts"
import { bedrockRoutes } from "./routes/bedrock.ts"
import { gatewayRoutes } from "./routes/gateway.ts"
import { googleRoutes } from "./routes/google.ts"
import { modelRoutes } from "./routes/models.ts"
import { openaiRoutes } from "./routes/openai.ts"
import { perplexityRoutes } from "./routes/perplexity.ts"

export { LLM_BEHAVIOURS, type LlmBehaviour } from "./behaviours.ts"
export type { LlmProvider, LlmReply, LlmSource, LlmToolCall } from "./entities.ts"
export { llmOutboundFaults } from "./faults.ts"
export { BEDROCK_HOSTS, GOOGLE_AI_HOST, LLM_HOSTS, PERPLEXITY_HOST } from "./helpers.ts"
export { type LlmCall, type LlmCalls, llmCalls, type LlmScripts, llmScripts } from "./inspect.ts"
export type { LlmRecordOptions } from "./record.ts"
export type { LlmMatchInput, LlmScript } from "./scripts.ts"
export { type LlmSeedConfig, seedLlm } from "./seed.ts"

/**
 * Model APIs on their real hostnames, answering from scripts instead of a model:
 * - OpenAI's Chat Completions, Responses, embeddings and models (`api.openai.com`);
 * - Anthropic's Messages and token counting (`api.anthropic.com`);
 * - the Vercel AI Gateway's language and embedding models (`ai-gateway.vercel.sh`);
 * - Google's Gemini API: `generateContent`, its stream, token counting and embeddings
 *   (`generativelanguage.googleapis.com`);
 * - Perplexity's Agent and Sonar APIs, with citations (`api.perplexity.ai`);
 * - Amazon Bedrock's Converse, ConverseStream, InvokeModel and its stream, in AWS's event stream
 *   framing (`bedrock-runtime.<region>.amazonaws.com`).
 *
 * Answers stream when asked, count tokens and cost the same way every time, and can be recorded
 * once from the real provider (all but Bedrock). It answers only what the danwo proxy routes to
 * it: the app's calls, never danwo's own agent, which calls its model directly.
 */
export const llm = defineEmulator({
  name: "llm",
  setup(emulator) {
    emulator.app.onError(providerErrors(llmError))
    emulator.app.use(llmAuth)
    openaiRoutes(emulator)
    anthropicRoutes(emulator)
    gatewayRoutes(emulator)
    modelRoutes(emulator)
    googleRoutes(emulator)
    perplexityRoutes(emulator)
    bedrockRoutes(emulator)
  },
})
