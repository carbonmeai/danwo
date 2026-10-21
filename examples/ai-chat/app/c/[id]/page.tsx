import { notFound } from "next/navigation"

import { CONVERSATION_ID, loadMessages } from "../../../lib/conversations.ts"
import { Chat } from "../../chat.tsx"
import { Topbar } from "../../topbar.tsx"

export const dynamic = "force-dynamic"

/** A saved conversation, as it was left: every message and how each answer ended. */
export default async function ConversationPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params

  if (!CONVERSATION_ID.test(id)) notFound()

  const messages = await loadMessages(id)

  return (
    <>
      <Topbar page="Conversation" />
      <main className="shell-content">
        <Chat id={id} initialMessages={messages} />
      </main>
    </>
  )
}
