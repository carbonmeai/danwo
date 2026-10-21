"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react"

import { OUTCOME_NOTES, type SupportMessage, textOf } from "../lib/messages.ts"
import { ToolPart } from "./tool-part.tsx"

/** Questions a new conversation suggests. */
const SUGGESTIONS = ["Where is my order 1043?", "My mug from order 1042 arrived broken"]

/**
 * The page sends only the newest message: the server keeps the conversation, so what the model
 * sees is what was saved, never what a page claims was said.
 */
const transport = new DefaultChatTransport<SupportMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, message: messages.at(-1) } }),
})

/** The error's text for the customer; a JSON error body is read for its message. */
function readable(error: Error): string {
  try {
    const parsed: unknown = JSON.parse(error.message)
    const message = Reflect.get(Object(parsed), "error")

    return typeof message === "string" ? message : error.message
  } catch {
    return error.message
  }
}

/** Whether a message has anything to show: text, or a tool the assistant called. */
function visible(message: SupportMessage): boolean {
  return message.parts.some((part) =>
    part.type === "text" ? part.text !== "" : part.type.startsWith("tool-"),
  )
}

/** The conversation with the support assistant, streaming, saved as it goes. */
export function Chat({
  id,
  initialMessages,
}: {
  readonly id: string
  readonly initialMessages: SupportMessage[]
}) {
  const [draft, setDraft] = useState("")
  const { messages, sendMessage, regenerate, stop, status, error } = useChat<SupportMessage>({
    id,
    messages: initialMessages,
    transport,
  })
  const busy = status === "submitted" || status === "streaming"
  const shown = messages.filter(visible)
  const last = messages.at(-1)

  function send(text: string) {
    const question = text.trim()

    if (question === "" || busy) return
    /* The first message saves the conversation: from now on it has an address of its own. */
    if (window.location.pathname === "/") window.history.replaceState(null, "", `/c/${id}`)
    void sendMessage({ text: question })
    setDraft("")
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    send(draft)
  }

  /* Enter sends, Shift+Enter starts a new line. */
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      send(draft)
    }
  }

  return (
    <section className="chat" data-status={status} aria-label="Support chat">
      {shown.length === 0 ? (
        <div className="empty">
          <p className="empty-title">How can we help?</p>
          <p className="empty-text">
            Ask about an order, or tell us something arrived broken and we&apos;ll open a ticket.
          </p>
          <div className="row justify-center">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="chat-log" aria-label="Conversation">
          {shown.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              streaming={busy && message === last && message.role === "assistant"}
              canRegenerate={!busy && message === last && message.role === "assistant"}
              onRegenerate={() => void regenerate()}
            />
          ))}
          {status === "submitted" && (
            <li className="chat-typing" aria-label="The assistant is typing">
              <span />
              <span />
              <span />
            </li>
          )}
        </ol>
      )}

      {error && (
        <div className="toast toast-error chat-error" role="alert">
          <div>
            <p className="toast-title">No answer</p>
            <p className="toast-text">{readable(error)}</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void regenerate()}
          >
            Retry
          </button>
        </div>
      )}

      <form className="chat-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          className="input chat-input"
          rows={2}
          placeholder="Ask about an order…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        {busy ? (
          <button type="button" className="btn btn-secondary" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={draft.trim() === ""}>
            Send
          </button>
        )}
      </form>
    </section>
  )
}

/**
 * One message. An answer shows the tools it called (an order, a ticket) above its text, and a note
 * when it didn't end in full. `data-updates` counts how many times its text changed while it
 * streamed in, so a test can tell a streamed answer from one that arrived in one piece.
 */
function MessageView({
  message,
  streaming,
  canRegenerate,
  onRegenerate,
}: {
  readonly message: SupportMessage
  readonly streaming: boolean
  readonly canRegenerate: boolean
  readonly onRegenerate: () => void
}) {
  const text = textOf(message)
  const updates = useRef({ text, count: 0 })

  if (updates.current.text !== text) updates.current = { text, count: updates.current.count + 1 }

  const outcome = message.metadata?.outcome ?? (streaming ? undefined : "interrupted")
  const note = outcome && message.role === "assistant" ? OUTCOME_NOTES[outcome] : undefined

  return (
    <li
      className={`chat-message chat-${message.role}`}
      data-testid="message"
      data-role={message.role}
      data-outcome={message.role === "assistant" ? (outcome ?? "streaming") : undefined}
      data-updates={updates.current.count}
      aria-busy={streaming}
    >
      <span className="chat-avatar" aria-hidden="true">
        {message.role === "user" ? "You" : "P&C"}
      </span>
      <div className="chat-body">
        {message.parts.map((part, index) =>
          part.type === "tool-lookupOrder" || part.type === "tool-createTicket" ? (
            <ToolPart key={index} part={part} live={streaming} />
          ) : null,
        )}
        {text !== "" && (
          <p className="chat-text" data-testid="message-text">
            {text}
          </p>
        )}
        {note && (
          <p className="chat-note" data-testid="message-note">
            {note}
          </p>
        )}
        {canRegenerate && (
          <button
            type="button"
            className="btn btn-ghost btn-sm chat-regenerate"
            onClick={onRegenerate}
          >
            Regenerate
          </button>
        )}
      </div>
    </li>
  )
}
