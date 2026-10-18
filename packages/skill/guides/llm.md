# Testing an app that calls a model

danwo answers the app's calls to OpenAI (`api.openai.com`), Anthropic (`api.anthropic.com`) and the
Vercel AI Gateway (`ai-gateway.vercel.sh`) from scripts, through the same proxy as the other
emulators. The official `openai` and `@anthropic-ai/sdk` clients and the AI SDK work unchanged,
streaming included. Answers are the same every run and cost nothing.

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
  `tool` (offered by name) and `toolResult` (the turn after a tool call). Every given field must
  match; the first matching script answers.
- `reply` is `text`, `toolCalls`, `json` (a structured answer, checked against the schema the call
  asked for), `refusal`, or `stop: "length" | "content_filter"`. A list of replies is given out in
  turn, the last one repeating.
- `unscripted: "echo"` (the default) answers an unscripted call with its own words, marked
  `[danwo: unscripted]`; `"fail"` answers it with a 500, so a test notices.
- Token counts are an estimate (about four characters a token), the same every run, and
  `prices` (dollars per million tokens) give each call a cost; the gateway reports it as its own.

Add scripts from a test with `llmScripts(llm).add(...)`, and read the app's calls back with
`llmCalls(llm).all()`: model, system prompt, messages, tools offered, the reply, tokens and cost.

## Recording

Give the seed `record: { file: "tests/llm-scripts.json", keys: { openai: process.env.OPENAI_API_KEY } }`
and every unscripted call is asked of the real provider once, with your own key, and saved as a
script for that exact request. Later runs replay the file for nothing; leave `keys` out in CI. Keys
are held in memory only and scrubbed from the file.

## Faults

`danwo matrix` breaks each model call in turn: a 429 with the provider's rate-limit headers, a 500,
a 503 (529 overloaded on Anthropic), a prompt over the context window, a slow or dropped
connection, and answers only the emulator can shape: `refusal`, `empty-completion`, `truncated`,
`content-filter`, `malformed-tool-call` and `stream-cut`. Good invariants for an assistant: the
customer never sees raw error text, a paid action runs at most once, and the agent stops after a few
failed tool calls.
