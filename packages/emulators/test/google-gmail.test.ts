import { google as googleapis } from "googleapis"
import { afterEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import {
  type GmailMailbox,
  gmailMailbox,
  type IncomingMail,
  type MailboxMessage,
  revokeGoogleAccess,
} from "../src/google/index.ts"
import { AUTH, authFor, consent, failure, fetchVia, googleWith, only } from "./google-api.ts"

const MODIFY = `${AUTH}gmail.modify`
const READONLY = `${AUTH}gmail.readonly`

let emulator: Emulator

afterEach(async () => {
  await emulator.close()
})

async function gmailAs(email: string, scopes: readonly string[] = [MODIFY]) {
  const tokens = await consent(emulator, email, scopes)

  return googleapis.gmail({
    version: "v1",
    auth: authFor(emulator, tokens),
    fetchImplementation: fetchVia(emulator),
  })
}

function rfc822(lines: readonly string[]): string {
  return Buffer.from(lines.join("\r\n")).toString("base64url")
}

describe("Gmail messages", () => {
  it("sends mail that lands in the recipient's inbox and the sender's sent mail", async () => {
    emulator = googleWith()
    const ada = await gmailAs("ada@danwo.test")
    const sent = await ada.users.messages.send({
      userId: "me",
      requestBody: {
        raw: rfc822([
          "To: Bob <bob@danwo.test>",
          "Subject: Lunch?",
          "",
          "Noon at the usual place.",
        ]),
      },
    })

    expect(sent.data.labelIds).toEqual(["SENT"])

    const bob = await gmailAs("bob@danwo.test")
    const listed = await bob.users.messages.list({ userId: "me", q: "from:ada subject:lunch" })
    const id = only(only(listed.data.messages)[0]?.id)
    const full = await bob.users.messages.get({ userId: "me", id })
    const payload = only(full.data.payload)

    expect(listed.data.resultSizeEstimate).toBe(1)
    expect(full.data).toMatchObject({
      labelIds: ["INBOX", "UNREAD"],
      snippet: "Noon at the usual place.",
    })
    expect(payload.headers).toEqual(
      expect.arrayContaining([
        { name: "From", value: "ada@danwo.test" },
        { name: "Subject", value: "Lunch?" },
      ]),
    )
    expect(Buffer.from(only(payload.body?.data), "base64url").toString()).toBe(
      "Noon at the usual place.",
    )
  })

  it("answers the raw and metadata formats", async () => {
    emulator = googleWith({
      gmail: { "ada@danwo.test": [{ from: "x@vendor.test", subject: "Lunch?", text: "Noon." }] },
    })
    const ada = await gmailAs("ada@danwo.test")
    const id = only(only((await ada.users.messages.list({ userId: "me" })).data.messages)[0]?.id)
    const raw = await ada.users.messages.get({ userId: "me", id, format: "raw" })
    const metadata = await ada.users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["Subject"],
    })
    const message: MailboxMessage = only(gmailMailbox(emulator, "ada@danwo.test").inbox()[0])

    expect(Buffer.from(only(raw.data.raw), "base64url").toString()).toContain("Subject: Lunch?")
    expect(metadata.data.payload?.headers).toEqual([{ name: "Subject", value: "Lunch?" }])
    expect(message).toMatchObject({ subject: "Lunch?", text: "Noon.", from: "x@vendor.test" })
  })

  it("serves attachments", async () => {
    emulator = googleWith({
      gmail: {
        "ada@danwo.test": [
          {
            from: "Billing <billing@vendor.test>",
            subject: "Invoice 42",
            text: "Attached.",
            attachments: [
              {
                filename: "invoice.pdf",
                mimeType: "application/pdf",
                content: Buffer.from("%PDF"),
              },
            ],
          },
        ],
      },
    })
    const ada = await gmailAs("ada@danwo.test")
    const listed = await ada.users.messages.list({ userId: "me", q: "has:attachment" })
    const messageId = only(only(listed.data.messages)[0]?.id)
    const message = await ada.users.messages.get({ userId: "me", id: messageId })
    const part = only(message.data.payload?.parts?.find((p) => p.filename === "invoice.pdf"))
    const data = await ada.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: only(part.body?.attachmentId),
    })

    expect(Buffer.from(only(data.data.data), "base64url").toString()).toBe("%PDF")
  })

  it("pages through lists, searches by date and threads replies", async () => {
    const incoming: IncomingMail[] = [
      { from: "billing@vendor.test", subject: "Invoice 42", text: "Due." },
      { from: "news@vendor.test", subject: "Weekly digest", text: "News" },
    ]

    emulator = googleWith({
      gmail: {
        "ada@danwo.test": [
          ...incoming,
          { from: "news@vendor.test", subject: "Old digest", text: "Old", date: "2020-01-01" },
        ],
      },
    })
    const ada = await gmailAs("ada@danwo.test")
    const first = await ada.users.messages.list({ userId: "me", maxResults: 2 })
    const second = await ada.users.messages.list({
      userId: "me",
      maxResults: 2,
      pageToken: only(first.data.nextPageToken),
    })
    const recent = await ada.users.messages.list({ userId: "me", q: "after:2021/01/01" })

    expect([first.data.messages?.length, second.data.messages?.length]).toEqual([2, 1])
    expect(second.data.nextPageToken).toBeUndefined()
    expect(recent.data.resultSizeEstimate).toBe(2)

    const invoice = only(
      (await ada.users.messages.list({ userId: "me", q: "subject:invoice" })).data.messages,
    )[0]
    const threadId = only(invoice?.threadId)
    const reply = await ada.users.messages.send({
      userId: "me",
      requestBody: {
        threadId,
        raw: rfc822(["To: billing@vendor.test", "Subject: Re: Invoice 42", "", "Paid."]),
      },
    })
    const thread = await ada.users.threads.get({ userId: "me", id: threadId })

    expect(reply.data.threadId).toBe(threadId)
    expect(thread.data.messages?.map((m) => m.labelIds)).toEqual([["INBOX", "UNREAD"], ["SENT"]])
  })

  it("labels, modifies, trashes and deletes, each within the granted scope", async () => {
    emulator = googleWith({
      gmail: { "ada@danwo.test": [{ from: "x@vendor.test", subject: "Hello", text: "Hi" }] },
    })
    const ada = await gmailAs("ada@danwo.test")
    const id = (await ada.users.messages.list({ userId: "me" })).data.messages?.[0]?.id ?? ""
    const label = await ada.users.labels.create({
      userId: "me",
      requestBody: { name: "Receipts", labelListVisibility: "labelShow" },
    })

    expect(
      await failure(ada.users.labels.create({ userId: "me", requestBody: { name: "receipts" } })),
    ).toEqual({
      status: 409,
      reason: "duplicate",
    })

    await ada.users.messages.modify({
      userId: "me",
      id,
      requestBody: { addLabelIds: [label.data.id ?? ""], removeLabelIds: ["UNREAD"] },
    })

    const counted = await ada.users.labels.get({ userId: "me", id: label.data.id ?? "" })

    expect(counted.data).toMatchObject({ name: "Receipts", messagesTotal: 1, messagesUnread: 0 })
    expect(
      await failure(
        ada.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: ["Label_99"] } }),
      ),
    ).toEqual({
      status: 400,
      reason: "invalidArgument",
    })

    await ada.users.messages.trash({ userId: "me", id })
    expect((await ada.users.messages.list({ userId: "me" })).data.resultSizeEstimate).toBe(0)
    expect(
      (await ada.users.messages.list({ userId: "me", q: "in:trash" })).data.resultSizeEstimate,
    ).toBe(1)
    expect(await failure(ada.users.messages.delete({ userId: "me", id }))).toEqual({
      status: 403,
      reason: "insufficientPermissions",
    })

    const full = await gmailAs("ada@danwo.test", ["https://mail.google.com/"])

    await full.users.messages.delete({ userId: "me", id })
    expect(await failure(ada.users.messages.get({ userId: "me", id }))).toEqual({
      status: 404,
      reason: "notFound",
    })
  })

  it("refuses calls the token's scopes do not cover, and other people's mailboxes", async () => {
    emulator = googleWith()
    const reader = await gmailAs("ada@danwo.test", [READONLY])

    expect(
      await failure(
        reader.users.messages.send({
          userId: "me",
          requestBody: { raw: rfc822(["Subject: x", "", "y"]) },
        }),
      ),
    ).toEqual({ status: 403, reason: "insufficientPermissions" })
    expect(await failure(reader.users.messages.list({ userId: "bob@danwo.test" }))).toEqual({
      status: 403,
      reason: "forbidden",
    })
  })

  it("keeps drafts and sends them", async () => {
    emulator = googleWith()
    const ada = await gmailAs("ada@danwo.test")
    const draft = await ada.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: rfc822(["To: bob@danwo.test", "Subject: Plan", "", "v1"]) } },
    })

    await ada.users.drafts.update({
      userId: "me",
      id: draft.data.id ?? "",
      requestBody: { message: { raw: rfc822(["To: bob@danwo.test", "Subject: Plan", "", "v2"]) } },
    })
    expect((await ada.users.drafts.list({ userId: "me" })).data.drafts).toHaveLength(1)

    await ada.users.drafts.send({ userId: "me", requestBody: { id: draft.data.id ?? "" } })

    expect((await ada.users.drafts.list({ userId: "me" })).data.drafts).toBeUndefined()
    expect(gmailMailbox(emulator, "bob@danwo.test").inbox()[0]?.text).toBe("v2")
  })

  it("sends a message uploaded as message/rfc822", async () => {
    emulator = googleWith()
    const ada = await gmailAs("ada@danwo.test", [`${AUTH}gmail.send`])

    await ada.users.messages.send({
      userId: "me",
      requestBody: {},
      media: {
        mimeType: "message/rfc822",
        body: ["To: bob@danwo.test", "Subject: Uploaded", "", "Via upload."].join("\r\n"),
      },
    })

    expect(gmailMailbox(emulator, "bob@danwo.test").inbox()[0]?.subject).toBe("Uploaded")
  })
})

describe("Gmail history and push", () => {
  it("syncs from a history id, and gives 404 once that history is gone", async () => {
    emulator = googleWith()
    const ada = await gmailAs("ada@danwo.test")
    const start = only((await ada.users.getProfile({ userId: "me" })).data.historyId)
    const mailbox: GmailMailbox = gmailMailbox(emulator, "ada@danwo.test")
    const arrived = mailbox.deliver({ from: "x@vendor.test", subject: "New", text: "Hello" })

    await ada.users.messages.modify({
      userId: "me",
      id: arrived.id,
      requestBody: { removeLabelIds: ["UNREAD"] },
    })

    const history = await ada.users.history.list({ userId: "me", startHistoryId: start })

    expect(
      history.data.history?.map((h) =>
        Object.keys(h).filter((k) => k !== "id" && k !== "messages"),
      ),
    ).toEqual([["messagesAdded"], ["labelsRemoved"]])
    expect(history.data.history?.[1]?.labelsRemoved?.[0]?.labelIds).toEqual(["UNREAD"])

    const added = await ada.users.history.list({
      userId: "me",
      startHistoryId: start,
      historyTypes: ["messageAdded"],
    })

    expect(added.data.history).toHaveLength(1)

    mailbox.expireHistory()
    expect(await failure(ada.users.history.list({ userId: "me", startHistoryId: start }))).toEqual({
      status: 404,
      reason: "notFound",
    })
  })

  it("pushes the history id to the watched topic's push subscriptions", async () => {
    const deliveries: { url: string; body: unknown }[] = []

    emulator = googleWith(
      {
        pubsub: [
          {
            subscription: "projects/app/subscriptions/gmail-push",
            topic: "projects/app/topics/gmail",
            endpoint: "https://app.danwo.test/push/gmail",
          },
        ],
      },
      {
        fetch: async (url, init) => {
          const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "null")

          deliveries.push({ url: url instanceof Request ? url.url : url.toString(), body })

          return new Response(null, { status: 204 })
        },
      },
    )
    const ada = await gmailAs("ada@danwo.test")
    const watch = await ada.users.watch({
      userId: "me",
      requestBody: { topicName: "projects/app/topics/gmail", labelIds: ["INBOX"] },
    })

    expect(Number(watch.data.expiration)).toBeGreaterThan(Date.now())

    gmailMailbox(emulator, "ada@danwo.test").deliver({ from: "x@vendor.test", subject: "Ping" })
    gmailMailbox(emulator, "ada@danwo.test").deliver({
      from: "x@vendor.test",
      subject: "Filed",
      labelIds: ["CATEGORY_UPDATES"],
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await emulator.webhooks?.idle()

    expect(deliveries).toHaveLength(1)
    const envelope = deliveries[0]?.body as { message: { data: string }; subscription: string }

    expect(deliveries[0]?.url).toBe("https://app.danwo.test/push/gmail")
    expect(envelope.subscription).toBe("projects/app/subscriptions/gmail-push")
    expect(JSON.parse(Buffer.from(envelope.message.data, "base64").toString())).toEqual({
      emailAddress: "ada@danwo.test",
      historyId: String(Number(watch.data.historyId) + 1),
    })

    await ada.users.stop({ userId: "me" })
    gmailMailbox(emulator, "ada@danwo.test").deliver({ from: "x@vendor.test", subject: "After" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(deliveries).toHaveLength(1)
  })
})

describe("Gmail access grants", () => {
  it("adds earlier scopes with include_granted_scopes, and stops working once access is revoked", async () => {
    emulator = googleWith()
    const first = await consent(emulator, "ada@danwo.test", ["openid", "email"])

    expect(first.scope).toBe("openid https://www.googleapis.com/auth/userinfo.email")

    const more = await consent(emulator, "ada@danwo.test", [READONLY], {
      include_granted_scopes: "true",
    })

    expect(more.scope.split(" ").toSorted()).toEqual(
      ["openid", "https://www.googleapis.com/auth/userinfo.email", READONLY].toSorted(),
    )

    const auth = authFor(emulator, more)
    const gmail = googleapis.gmail({ version: "v1", auth, fetchImplementation: fetchVia(emulator) })

    expect((await gmail.users.getProfile({ userId: "me" })).data.emailAddress).toBe(
      "ada@danwo.test",
    )

    revokeGoogleAccess(emulator, "ada@danwo.test")

    const direct = await emulator.fetch(
      new Request("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { authorization: `Bearer ${more.access_token}` },
      }),
    )

    expect(direct.status).toBe(401)
    expect(((await direct.json()) as { error: { status: string } }).error.status).toBe(
      "UNAUTHENTICATED",
    )
    // The client answers a 401 by refreshing, which the revoked grant refuses.
    await expect(gmail.users.getProfile({ userId: "me" })).rejects.toThrow(/invalid_grant/)
  })
})
