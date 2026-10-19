/** Outlook tools, run on the Microsoft emulator through Microsoft Graph. */
import { asRecord } from "../../json.ts"
import { seedMicrosoft } from "../../microsoft/index.ts"
import { microsoftStore } from "../../microsoft/store.ts"
import { OAUTH_CALLBACK } from "../helpers.ts"
import {
  apiCall,
  arg,
  argList,
  argNumber,
  type Backend,
  type Executor,
  tokenEndpoint,
  withQuery,
} from "./backend.ts"

const GRAPH = "https://graph.microsoft.com/v1.0"
const LOGIN = "https://login.microsoftonline.com/common/oauth2/v2.0"

const recipients = (addresses: readonly string[]) =>
  addresses.map((address) => ({ emailAddress: { address } }))

const tools: Record<string, Executor> = {
  async OUTLOOK_SEND_EMAIL({ args, token, send }) {
    const sent = await apiCall(send, token, "POST", `${GRAPH}/me/sendMail`, {
      message: {
        subject: arg(args, "subject") ?? "",
        body: {
          contentType: args["is_html"] === true ? "HTML" : "Text",
          content: arg(args, "body") ?? "",
        },
        toRecipients: recipients(argList(args, "to_email")),
        ccRecipients: recipients(argList(args, "cc_emails")),
        bccRecipients: recipients(argList(args, "bcc_emails")),
      },
      saveToSentItems: true,
    })

    return sent.error === undefined ? { status: sent.status, data: {} } : sent
  },
  OUTLOOK_LIST_MESSAGES: ({ args, token, send }) =>
    apiCall(
      send,
      token,
      "GET",
      withQuery(
        `${GRAPH}/me/mailFolders/${encodeURIComponent(arg(args, "folder") ?? "inbox")}/messages`,
        {
          $top: argNumber(args, "top") ?? 10,
        },
      ),
    ),
}

export const microsoftBackend: Backend = {
  name: "microsoft",
  toolkits: ["outlook"],
  managedClient: {
    client_id: "5c0e2c6b-7a4d-4f4e-9b61-c0a1b2c3d4e5",
    client_secret: "Composio~managed~secret",
  },
  authorizeUrl: (client, scopes, state) =>
    withQuery(`${LOGIN}/authorize`, {
      client_id: client.client_id,
      redirect_uri: OAUTH_CALLBACK,
      response_type: "code",
      response_mode: "query",
      scope: scopes.join(" "),
      state,
    }),
  ...tokenEndpoint(`${LOGIN}/token`),
  async whoami(send, token) {
    const me = asRecord((await apiCall(send, token, "GET", `${GRAPH}/me`)).data)
    const address = me?.["mail"] ?? me?.["userPrincipalName"]

    return typeof address === "string" ? address : null
  },
  register(emulator, client) {
    if (microsoftStore(emulator.store).clients.findOneBy("client_id", client.client_id)) return

    seedMicrosoft(emulator, {
      oauth_clients: [{ ...client, name: "Composio", redirect_uris: [OAUTH_CALLBACK] }],
    })
  },
  apiBase: () => GRAPH,
  tools,
}
