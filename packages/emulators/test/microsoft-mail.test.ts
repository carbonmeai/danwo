import type { Message } from "@microsoft/microsoft-graph-types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import {
  type MailboxMessage,
  type OutlookMailbox,
  microsoftOutboundFaults,
  outlookMailbox,
  revokeMicrosoftSessions,
} from "../src/microsoft/index.ts"
import {
  ADA,
  CLIENT_ID,
  CLIENT_SECRET,
  GRACE,
  graphClient,
  graphEmulator,
  graphFetch,
  tokensFor,
} from "./microsoft-graph.ts"

const READ_WRITE = "openid profile User.Read Mail.ReadWrite Mail.Send"

let emulator: Emulator

beforeEach(() => {
  emulator = graphEmulator({
    mail: [
      {
        user: ADA,
        from: { name: "Billing", address: "billing@vendor.test" },
        subject: "Invoice 1042",
        body: "<p>Your invoice is <b>ready</b>.</p>",
        receivedDateTime: "2026-10-01T09:00:00Z",
        attachments: [{ name: "invoice.pdf", contentType: "application/pdf", content: "%PDF-1.7" }],
      },
      {
        user: ADA,
        from: "grace@contoso.test",
        subject: "Lunch?",
        body: "Thursday at noon",
        bodyType: "text",
        isRead: true,
        receivedDateTime: "2026-10-02T09:00:00Z",
      },
      {
        user: ADA,
        from: "news@paper.test",
        subject: "Morning briefing",
        receivedDateTime: "2026-10-03T09:00:00Z",
      },
    ],
  })
})

afterEach(async () => {
  await emulator.close()
})

describe("reading mail with the Graph client", () => {
  it("lists the inbox newest first, pages with $top and follows @odata.nextLink", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)
    const first = await client.api("/me/mailFolders/inbox/messages").top(2).get()

    expect(first.value.map((m: Message) => m.subject)).toEqual(["Morning briefing", "Lunch?"])
    expect(first["@odata.nextLink"]).toContain("%24skip=2")

    const second = await client.api(first["@odata.nextLink"]).get()

    expect(second.value.map((m: Message) => m.subject)).toEqual(["Invoice 1042"])
    expect(second["@odata.nextLink"]).toBeUndefined()
  })

  it("filters, orders and selects as asked", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)
    const unread = await client
      .api("/me/messages")
      .filter("isRead eq false and receivedDateTime ge 2026-10-01T00:00:00Z")
      .orderby("receivedDateTime asc")
      .select("subject,from")
      .get()

    expect(unread.value).toEqual([
      expect.objectContaining({ subject: "Invoice 1042", from: expect.anything() }),
      expect.objectContaining({ subject: "Morning briefing" }),
    ])
    expect(Object.keys(unread.value[0]).toSorted()).toEqual([
      "@odata.etag",
      "from",
      "id",
      "subject",
    ])

    const fromGrace = await client
      .api("/me/messages")
      .filter("from/emailAddress/address eq 'grace@contoso.test'")
      .get()

    expect(fromGrace.value.map((m: Message) => m.subject)).toEqual(["Lunch?"])
  })

  it("refuses a filter it cannot evaluate with Graph's error", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)

    await expect(
      client.api("/me/messages").filter("contains(subject, 'x')").get(),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "ErrorInvalidUrlQueryFilter",
    })
  })

  it("returns plain-text bodies when the reader prefers them, and says so", async () => {
    const { access } = tokensFor(emulator, ADA, READ_WRITE)
    const list = await graphFetch(
      emulator,
      access,
      "/v1.0/me/messages?$filter=hasAttachments eq true",
      {
        headers: { prefer: 'outlook.body-content-type="text"' },
      },
    )
    const [message] = (await list.json()).value

    expect(list.headers.get("preference-applied")).toBe('outlook.body-content-type="text"')
    expect(message.body).toEqual({ contentType: "text", content: "Your invoice is ready." })
  })

  it("reads a message's attachments", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)
    const [invoice] = (await client.api("/me/messages").filter("hasAttachments eq true").get())
      .value
    const attachments = await client.api(`/me/messages/${invoice.id}/attachments`).get()
    const one = await client
      .api(`/me/messages/${invoice.id}/attachments/${attachments.value[0].id}`)
      .get()

    expect(one).toMatchObject({ name: "invoice.pdf", contentType: "application/pdf", size: 8 })
    expect(Buffer.from(one.contentBytes, "base64").toString()).toBe("%PDF-1.7")
  })
})

describe("writing and sending mail", () => {
  it("creates a draft, attaches a file, sends it, and delivers it to a mailbox here", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)
    const draft = await client.api("/me/messages").post({
      subject: "Q3 report",
      body: { contentType: "html", content: "<p>Attached.</p>" },
      toRecipients: [{ emailAddress: { address: GRACE } }],
    })

    expect(draft).toMatchObject({ isDraft: true, subject: "Q3 report" })

    await client.api(`/me/messages/${draft.id}/attachments`).post({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "q3.csv",
      contentBytes: Buffer.from("a,b\n1,2").toString("base64"),
    })
    await client.api(`/me/messages/${draft.id}/send`).post({})

    const graceMailbox: OutlookMailbox = outlookMailbox(emulator, GRACE)
    const received: MailboxMessage | undefined = graceMailbox.latest("inbox")

    expect(received).toMatchObject({
      subject: "Q3 report",
      from: ADA,
      isRead: false,
      attachments: [{ name: "q3.csv" }],
    })
    expect(outlookMailbox(emulator, ADA).latest("sentitems")).toMatchObject({
      subject: "Q3 report",
      isDraft: false,
    })
    expect(outlookMailbox(emulator, ADA).messages("drafts")).toEqual([])
  })

  it("sends with sendMail, replies and forwards", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)

    await client.api("/me/sendMail").post({
      message: {
        subject: "Hello",
        body: { contentType: "text", content: "Hi Grace" },
        toRecipients: [{ emailAddress: { address: GRACE } }],
      },
    })

    const graceClient = graphClient(emulator, GRACE, READ_WRITE)
    const [hello] = (await graceClient.api("/me/mailFolders/inbox/messages").get()).value

    await graceClient.api(`/me/messages/${hello.id}/reply`).post({ comment: "Hi Ada!" })
    await graceClient.api(`/me/messages/${hello.id}/forward`).post({
      comment: "FYI",
      toRecipients: [{ emailAddress: { address: "someone@elsewhere.test" } }],
    })

    expect(outlookMailbox(emulator, ADA).latest("inbox")).toMatchObject({
      subject: "RE: Hello",
      from: GRACE,
    })
    expect(
      outlookMailbox(emulator, GRACE)
        .messages("sentitems")
        .map((m) => m.subject),
    ).toEqual(["FW: Hello", "RE: Hello"])
  })

  it("refuses to send a message with no recipients", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)

    await expect(
      client.api("/me/sendMail").post({ message: { subject: "Nobody" } }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "ErrorInvalidRecipients",
    })
  })

  it("marks as read, moves, copies, and deletes to Deleted Items then for good", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)
    const [briefing] = (
      await client.api("/me/messages").filter("subject eq 'Morning briefing'").get()
    ).value

    expect((await client.api(`/me/messages/${briefing.id}`).patch({ isRead: true })).isRead).toBe(
      true,
    )

    const archive = await client.api("/me/mailFolders/archive").get()
    const moved = await client
      .api(`/me/messages/${briefing.id}/move`)
      .post({ destinationId: archive.id })
    const copy = await client
      .api(`/me/messages/${briefing.id}/copy`)
      .post({ destinationId: "inbox" })

    expect(moved.parentFolderId).toBe(archive.id)
    expect(copy.id).not.toBe(briefing.id)

    await client.api(`/me/messages/${copy.id}`).delete()
    expect(outlookMailbox(emulator, ADA).latest("deleteditems")?.id).toBe(copy.id)
    await client.api(`/me/messages/${copy.id}`).delete()
    await expect(client.api(`/me/messages/${copy.id}`).get()).rejects.toMatchObject({
      statusCode: 404,
      code: "ErrorItemNotFound",
    })
  })
})

describe("the inbox delta", () => {
  it("pages through the folder, then returns new, changed and removed messages", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)
    const pages: Message[] = []
    let page = await client
      .api("/me/mailFolders/inbox/messages/delta")
      .header("Prefer", "odata.maxpagesize=2")
      .get()

    pages.push(...page.value)

    while (page["@odata.nextLink"]) {
      page = await client.api(page["@odata.nextLink"]).header("Prefer", "odata.maxpagesize=2").get()
      pages.push(...page.value)
    }

    expect(pages).toHaveLength(3)

    const deltaLink: string = page["@odata.deltaLink"]
    const [invoice, lunch] = ["Invoice 1042", "Lunch?"].map((subject) =>
      pages.find((m) => m.subject === subject),
    )

    outlookMailbox(emulator, ADA).receive({ from: "new@vendor.test", subject: "Fresh" })
    await client.api(`/me/messages/${invoice?.id}`).patch({ isRead: true })
    await client.api(`/me/messages/${lunch?.id}/move`).post({ destinationId: "archive" })

    const changes = await client.api(deltaLink).get()

    expect(changes.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: "Fresh" }),
        expect.objectContaining({ id: invoice?.id, isRead: true }),
        { id: lunch?.id, "@removed": { reason: "deleted" } },
      ]),
    )
    expect(changes.value).toHaveLength(3)
    expect((await client.api(changes["@odata.deltaLink"]).get()).value).toEqual([])
  })

  it("answers an unknown delta token with 410 SyncStateNotFound", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)

    await expect(
      client.api("/me/mailFolders/inbox/messages/delta?$deltatoken=bogus").get(),
    ).rejects.toMatchObject({
      statusCode: 410,
      code: "SyncStateNotFound",
    })
  })
})

describe("permissions and sessions", () => {
  it("enforces delegated scopes per call", async () => {
    const reader = graphClient(emulator, ADA, "Mail.Read")
    const nothing = graphClient(emulator, ADA, "User.Read")

    await expect(reader.api("/me/messages").get()).resolves.toMatchObject({
      value: expect.any(Array),
    })
    await expect(
      reader
        .api("/me/sendMail")
        .post({ message: { toRecipients: [{ emailAddress: { address: GRACE } }] } }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "ErrorAccessDenied",
    })
    await expect(nothing.api("/me/messages").get()).rejects.toMatchObject({
      statusCode: 403,
      code: "ErrorAccessDenied",
    })
  })

  it("reaches only the signed-in user's mailbox through /users", async () => {
    const client = graphClient(emulator, ADA, READ_WRITE)

    await expect(client.api(`/users/${ADA}/messages`).get()).resolves.toMatchObject({
      value: expect.any(Array),
    })
    await expect(client.api(`/users/${GRACE}/messages`).get()).rejects.toMatchObject({
      statusCode: 403,
    })
    await expect(client.api("/users/nobody@contoso.test/messages").get()).rejects.toMatchObject({
      statusCode: 404,
      code: "ErrorInvalidUser",
    })
  })

  it("after the user's sessions are revoked, refuses their tokens and refresh tokens", async () => {
    const { access, refresh } = tokensFor(emulator, ADA, READ_WRITE)

    expect(revokeMicrosoftSessions(emulator, ADA)).toBeGreaterThan(0)

    const api = await graphFetch(emulator, access, "/v1.0/me/messages")
    const token = await emulator.fetch(
      new Request("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      }),
    )

    expect(api.status).toBe(401)
    expect(await api.json()).toMatchObject({ error: { code: "InvalidAuthenticationToken" } })
    expect(token.status).toBe(400)
    expect(await token.json()).toMatchObject({ error: "invalid_grant", error_codes: [50173] })
  })

  it("revokes every session through Graph's revokeSignInSessions", async () => {
    const { access } = tokensFor(emulator, ADA, READ_WRITE)
    const revoked = await graphFetch(emulator, access, "/v1.0/me/revokeSignInSessions", {
      method: "POST",
    })

    expect(await revoked.json()).toMatchObject({ value: true })
    expect((await graphFetch(emulator, access, "/v1.0/me")).status).toBe(401)
  })
})

describe("mail faults", () => {
  it("throttles, fails and drops mail calls for the fault matrix", () => {
    const list = microsoftOutboundFaults({
      method: "GET",
      path: "/v1.0/me/mailFolders/inbox/messages",
    })
    const send = microsoftOutboundFaults({ method: "POST", path: "/v1.0/me/sendMail" })
    const delta = microsoftOutboundFaults({
      method: "GET",
      path: "/v1.0/me/mailFolders/inbox/messages/delta",
    })

    expect(list).toContainEqual(
      expect.objectContaining({
        kind: "status",
        status: 429,
        headers: expect.objectContaining({ "retry-after": expect.any(String) }),
      }),
    )
    expect(send.map((f) => f.kind)).toContain("reset-after")
    expect(delta).toContainEqual(
      expect.objectContaining({ status: 410, body: expect.stringContaining("SyncStateNotFound") }),
    )
  })
})
