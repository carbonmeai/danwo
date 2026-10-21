# Testing an app that calls a model

danwo answers the app's calls to these model APIs from scripts, through the same proxy as the other
emulators:

| Provider          | Host                                     | What answers                                                                                            |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OpenAI            | `api.openai.com`                         | Chat Completions, Responses, embeddings, models                                                         |
| Anthropic         | `api.anthropic.com`                      | Messages, token counting, models                                                                        |
| Vercel AI Gateway | `ai-gateway.vercel.sh`                   | language and embedding models                                                                           |
| Google Gemini     | `generativelanguage.googleapis.com`      | `generateContent`, `streamGenerateContent`, `countTokens`, `embedContent`, `batchEmbedContents`, models |
| Perplexity        | `api.perplexity.ai`                      | the Agent API (`/v1/agent`) and Sonar (`/v1/sonar`, `/chat/completions`), with citations                |
| Amazon Bedrock    | `bedrock-runtime.<region>.amazonaws.com` | Converse, ConverseStream, InvokeModel and its stream                                                    |

The official clients (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`)
and the AI SDK's providers (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`,
`@ai-sdk/perplexity`, `@ai-sdk/amazon-bedrock`) work unchanged, streaming included. Answers are the
same every run and cost nothing. Any key works, sent the provider's way: Gemini's `x-goog-api-key`
or `?key=`, a bearer token for Perplexity, SigV4 or a Bedrock API key for Bedrock. Bedrock reads each
model family's own `InvokeModel` body: Claude's Messages, Nova's Converse shape, Titan text and
embeddings, Cohere embeddings, and a plain `prompt` for the rest. Vertex AI's hosts are not
emulated. Alongside MiniStack (`*.amazonaws.com`), Bedrock's runtime hosts still come here: a route's
exact hosts win over wildcards.

danwo's own agent calls its model directly from the runner, not through the proxy, so it is never
answered by these scripts.

## Scripts

```ts
import { defineConfig, llmEnvironment } from "@danwo/sdk"

const llm = await llmEnvironment({
  seed: {
    unscripted: "fail",
    prices: { "gpt-5-mini": { input: 0.25, output: 2 } },
    scripts: [
      {
        match: { user: /refund order/i, tool: "issue_refund", toolResult: false },
        reply: { toolCalls: [{ name: "issue_refund", arguments: { order: 42 } }] },
      },
      { match: { toolResult: true }, reply: { text: "Done! Order 42 has been refunded." } },
    ],
  },
})
```

- `match` takes `provider`, `model`, `user` (the last user message), `system` (regexes or strings),
  `tool` (offered by name) and `toolResult` (the turn after a tool call; a pattern also matches the tool result's text, its JSON or its error, so a script can answer a failed tool differently). Every given field must
  match; the first matching script answers.
- `reply` is `text`, `toolCalls`, `json` (a structured answer, checked against the schema the call
  asked for), `refusal`, or `stop: "length" | "content_filter"`, plus `sources` (`{ url, title,
  snippet, date }`), which Perplexity answers as its citations and search results. A list of replies
  is given out in turn, the last one repeating. `error: "rate-limit" | "server-error" | "overloaded"`
  answers with the provider's own 429 (with `Retry-After`), 500 or 503 (529 on Anthropic), so a list
  such as `[{ error: "rate-limit" }, { text: "…" }]` fails a call on cue and lets the retry through. On Bedrock, a `json` reply to the AI SDK's
  structured output comes back as a call to the `json` tool the SDK adds, as Bedrock models answer.
- `unscripted: "echo"` (the default) answers an unscripted call with its own words, marked
  `[danwo: unscripted]`; `"fail"` answers it with a 500, so a test notices.
- Token counts are an estimate (about four characters a token), the same every run, and
  `prices` (dollars per million tokens) give each call a cost; the gateway reports it as its own,
  split into input and output inference cost, with its routing and a generation id, and Perplexity
  reports it in its usage.
- `knownModelsOnly: true` makes the gateway answer a model `models` does not list with its 404
  `model_not_found`, for testing an app's handling of a mistyped model id.

Add scripts from a test with `llmScripts(llm).add(...)`, and read the app's calls back with
`llmCalls(llm).all()`: model, system prompt, messages, tools offered, the reply, tokens and cost.

## Recording

Give the seed `record: { file: "tests/llm-scripts.json", keys: { openai: process.env.OPENAI_API_KEY } }`
and every unscripted call is asked of the real provider once, with your own key, and saved as a
script for that exact request. Later runs replay the file for nothing; leave `keys` out in CI. Keys
are held in memory only and scrubbed from the file. `keys` takes `openai`, `anthropic`, `gateway`,
`google` and `perplexity`; Bedrock calls are not recorded, since replaying them to AWS would need
your secret to sign them again.

## Faults

`danwo matrix` breaks each model call in turn: a 429 with the provider's rate-limit headers, a 500,
a 503 (529 overloaded on Anthropic), a prompt over the context window, a slow or dropped
connection, and answers only the emulator can shape: `refusal`, `empty-completion`, `truncated`,
`content-filter`, `malformed-tool-call` and `stream-cut`. Each error comes in the provider's own
shape, so its SDK raises its own error: Gemini's `RESOURCE_EXHAUSTED` and `UNAVAILABLE`, Bedrock's
`ThrottlingException` and `ServiceUnavailableException` (named in `x-amzn-errortype`). Gemini
answers a malformed tool call with `MALFORMED_FUNCTION_CALL` and no content, as it does. Good invariants for an assistant: the
customer never sees raw error text, a paid action runs at most once, and the agent stops after a few
failed tool calls.
