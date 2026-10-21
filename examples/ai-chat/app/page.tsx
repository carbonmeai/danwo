import { randomBytes } from "node:crypto"

import { Chat } from "./chat.tsx"
import { Topbar } from "./topbar.tsx"

/* Each visit starts a conversation of its own; it is saved with its first message. */
export const dynamic = "force-dynamic"

export default function NewConversationPage() {
  const id = randomBytes(12).toString("base64url")

  return (
    <>
      <Topbar page="New conversation" />
      <main className="shell-content">
        <Chat id={id} initialMessages={[]} />
      </main>
    </>
  )
}
