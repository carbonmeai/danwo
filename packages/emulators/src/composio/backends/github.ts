/** GitHub tools, run on the GitHub emulator's REST API. */
import { seedGithub } from "../../github/seed.ts"
import { githubStore } from "../../github/store.ts"
import { asRecord } from "../../json.ts"
import { OAUTH_CALLBACK } from "../helpers.ts"
import {
  apiCall,
  arg,
  argList,
  type Backend,
  type Executor,
  tokenEndpoint,
  withQuery,
} from "./backend.ts"

const API = "https://api.github.com"
const TOKEN = "https://github.com/login/oauth/access_token"

const repoOf = (args: Readonly<Record<string, unknown>>): string =>
  `${encodeURIComponent(arg(args, "owner") ?? "")}/${encodeURIComponent(arg(args, "repo") ?? "")}`

const tools: Record<string, Executor> = {
  GITHUB_CREATE_AN_ISSUE: ({ args, token, send }) =>
    apiCall(send, token, "POST", `${API}/repos/${repoOf(args)}/issues`, {
      title: arg(args, "title"),
      body: arg(args, "body"),
      labels: argList(args, "labels"),
      assignees: argList(args, "assignees"),
    }),
  GITHUB_GET_A_REPOSITORY: ({ args, token, send }) =>
    apiCall(send, token, "GET", `${API}/repos/${repoOf(args)}`),
}

export const githubBackend: Backend = {
  name: "github",
  toolkits: ["github"],
  managedClient: {
    client_id: "Iv1.c0mp0s10managed",
    client_secret: "composio-managed-github-secret",
  },
  authorizeUrl: (client, scopes, state) =>
    withQuery("https://github.com/login/oauth/authorize", {
      client_id: client.client_id,
      redirect_uri: OAUTH_CALLBACK,
      scope: scopes.join(" "),
      state,
    }),
  ...tokenEndpoint(TOKEN),
  async whoami(send, token) {
    const login = asRecord((await apiCall(send, token, "GET", `${API}/user`)).data)?.["login"]

    return typeof login === "string" ? login : null
  },
  register(emulator, client) {
    if (githubStore(emulator.store).apps.findOneBy("clientId", client.client_id)) return

    seedGithub(emulator.store, {
      oauthApps: [
        {
          clientId: client.client_id,
          clientSecret: client.client_secret,
          name: "Composio",
          callbackUrls: [OAUTH_CALLBACK],
        },
      ],
    })
  },
  apiBase: () => API,
  tools,
}
