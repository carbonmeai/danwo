/*
 * An app under test that knows nothing about the proxy: the official OpenAI client and the AI
 * SDK's gateway provider, both on their default hosts. It streams a chat answer, then asks the
 * gateway with a tool, and prints what it got as JSON.
 */
import { generateText, stepCountIs, tool } from "ai"
import OpenAI from "openai"
import { z } from "zod"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const stream = await openai.chat.completions.create({
  model: "gpt-5-mini",
  stream: true,
  messages: [
    { role: "system", content: "You answer support questions." },
    { role: "user", content: "Do you ship to Ghana?" },
  ],
})
let chat = ""

for await (const chunk of stream) chat += chunk.choices[0]?.delta.content ?? ""

const answer = await generateText({
  model: "openai/gpt-5-mini",
  stopWhen: stepCountIs(3),
  tools: {
    stock: tool({
      description: "How many of an item are in stock",
      inputSchema: z.object({ item: z.string() }),
      execute: async ({ item }) => ({ item, count: 3 }),
    }),
  },
  prompt: "How many umbrellas are in stock?",
})

console.log(JSON.stringify({ chat, gateway: answer.text, steps: answer.steps.length }))
