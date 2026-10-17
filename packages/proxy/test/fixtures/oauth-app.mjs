/*
 * An app under test that knows nothing about the proxy: google-auth-library and MSAL with their
 * default endpoints (accounts.google.com, oauth2.googleapis.com, www.googleapis.com,
 * login.microsoftonline.com, graph.microsoft.com). The "browser" steps (open the sign-in page,
 * pick the account, follow the redirect) are plain fetches. Prints what it saw as JSON.
 */
import { ConfidentialClientApplication } from "@azure/msal-node"
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library"

const pick = (pattern, text) => pattern.exec(text)?.[1] ?? ""

/** Opens the sign-in page, picks `email`'s account and returns the code from the redirect. */
async function browse(url, email) {
  const html = await (await fetch(url)).text()
  const item = html.split("<li>").find((li) => li.includes(email)) ?? ""
  const request = pick(/name="request" value="([^"]+)"/, html)
  const user = pick(/name="user" value="([^"]+)"/, item)
  const action = pick(/<form method="post" action="([^"]+)"/, html)
  const back = await fetch(new URL(action, url), {
    method: "POST",
    body: new URLSearchParams({ request, user }),
    redirect: "manual",
  })

  return new URL(back.headers.get("location")).searchParams.get("code")
}

async function google() {
  const client = new OAuth2Client({
    clientId: "123-app.apps.googleusercontent.com",
    clientSecret: "GOCSPX-app-secret",
    redirectUri: "https://app.danwo.test/auth/google/callback",
  })
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
  })
  const code = await browse(url, "ada@danwo.test")
  const { tokens } = await client.getToken({ code, codeVerifier })
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token ?? "",
    audience: "123-app.apps.googleusercontent.com",
  })

  client.setCredentials(tokens)
  const info = await client.request({ url: "https://openidconnect.googleapis.com/v1/userinfo" })

  await client.revokeToken(tokens.refresh_token ?? "")

  return { email: ticket.getPayload()?.email, userinfo: info.data.email }
}

async function microsoft() {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId: "6731de76-14a6-49ae-97bc-6eba6914391e",
      clientSecret: "Qx~8Q~app-secret",
      authority: "https://login.microsoftonline.com/common",
    },
  })
  const redirectUri = "https://app.danwo.test/auth/microsoft/callback"
  const url = await app.getAuthCodeUrl({ scopes: ["User.Read"], redirectUri })
  const code = await browse(url, "grace@contoso.test")
  const result = await app.acquireTokenByCode({ code, scopes: ["User.Read"], redirectUri })
  const me = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { authorization: `Bearer ${result.accessToken}` },
  })

  return { username: result.account?.username, me: (await me.json()).displayName }
}

const out = {}

try {
  out.google = await google()
  out.microsoft = await microsoft()
} catch (error) {
  out.error = String(error?.stack ?? error)
}

console.log(JSON.stringify(out))
