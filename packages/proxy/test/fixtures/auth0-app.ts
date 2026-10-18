/*
 * An app under test that knows nothing about the proxy: Express with express-openid-connect,
 * configured for an Auth0 tenant on its real domain. `/login` starts the code flow, `/callback`
 * finishes it, `/me` is a protected page that reads the profile from `/userinfo` with the
 * access token, and `/logout` ends the session at the tenant. It prints its port once listening.
 */
import express from "express"
import openid from "express-openid-connect"

const { auth, requiresAuth } = openid
const PORT = Number(process.env.PORT)
const app = express()

app.use(
  auth({
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN ?? ""}`,
    baseURL: `http://127.0.0.1:${PORT}`,
    clientID: process.env.AUTH0_CLIENT_ID ?? "",
    clientSecret: process.env.AUTH0_CLIENT_SECRET ?? "",
    secret: "a-long-cookie-secret-for-the-app-session",
    authRequired: false,
    idpLogout: true,
    authorizationParams: {
      response_type: "code",
      scope: "openid profile email",
      audience: process.env.AUTH0_AUDIENCE ?? "",
    },
  }),
)

app.get("/", (req, res) => {
  res.send(req.oidc.isAuthenticated() ? "signed in" : "signed out")
})

app.get("/me", requiresAuth(), (req, res, next) => {
  req.oidc
    .fetchUserInfo()
    .then((profile) =>
      res.json({
        email: profile.email,
        claims: req.oidc.idTokenClaims,
        scope: req.oidc.accessToken?.access_token ? "has access token" : "none",
      }),
    )
    .catch(next)
})

app.listen(PORT, "127.0.0.1", () => console.log(JSON.stringify({ port: PORT })))
