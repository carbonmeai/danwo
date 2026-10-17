import { generateKeyPairSync } from "node:crypto"

import type { Store } from "../store.ts"
import type {
  GithubAccount,
  GithubAppRecord,
  GithubIssueRecord,
  GithubPatRecord,
  GithubRepoRecord,
} from "./entities.ts"
import { commitTo } from "./git.ts"
import { nextGhId } from "./helpers.ts"
import { ensureLabels, openIssue } from "./issues.ts"
import { githubStore, type GithubStore } from "./store.ts"

/** Optional seed fields: everything in `T` may be left out. */
type Maybe<T> = Partial<Readonly<T>>

/** A person: `login`, a name, email addresses (the first is primary) and whether it is public. */
export type GithubSeedUser = { readonly login: string } & Maybe<{
  name: string
  emails: readonly string[]
  publicEmail: boolean
}>

export type GithubSeedOrg = { readonly login: string } & Maybe<{
  name: string
  members: readonly string[]
}>

/** A repository (`owner/name`), with files committed on its default branch. */
export type GithubSeedRepo = { readonly repo: string } & Maybe<{
  private: boolean
  description: string
  defaultBranch: string
  files: Readonly<Record<string, string>>
  topics: readonly string[]
}>

export type GithubSeedIssue = Readonly<Pick<GithubIssueRecord, "title" | "author">> & {
  readonly repo: string
} & Maybe<{ body: string; labels: readonly string[] }>

/** How an app signs people in. */
type SeedClient = Readonly<Pick<GithubAppRecord, "clientId" | "clientSecret" | "name">>

/** An OAuth App: it signs people in and acts with the scopes they grant. */
export type GithubSeedOAuthApp = SeedClient & {
  readonly callbackUrls: readonly string[]
} & Maybe<{ owner: string }>

/**
 * A GitHub App: installations, a webhook, permissions and, optionally, user sign-in. Without a
 * `privateKey` (PEM) one is generated; read it with `githubAppKey`.
 */
export type GithubSeedApp = SeedClient &
  Readonly<Pick<GithubAppRecord, "slug" | "owner">> &
  Maybe<{
    id: number
    privateKey: string
    webhookUrl: string
    webhookSecret: string
    permissions: Readonly<Record<string, string>>
    events: readonly string[]
    callbackUrls: readonly string[]
    expiringUserTokens: boolean
  }>

/** An app installed on an account: on all its repositories, or on the ones named. */
export type GithubSeedInstallation = { readonly app: string; readonly account: string } & Maybe<{
  id: number
  repositories: readonly string[]
}>

/** A personal access token (classic) for a person, with its scopes. */
export type GithubSeedToken = Readonly<Pick<GithubPatRecord, "token" | "login">> &
  Maybe<{ scopes: readonly string[] }>

/** A repository webhook. */
export type GithubSeedHook = { readonly repo: string; readonly url: string } & Maybe<{
  secret: string
  events: readonly string[]
}>

/** People, organisations, repositories, apps and credentials to load into a GitHub emulator. */
export type GithubSeedConfig = Maybe<{
  users: readonly GithubSeedUser[]
  orgs: readonly GithubSeedOrg[]
  repos: readonly GithubSeedRepo[]
  issues: readonly GithubSeedIssue[]
  oauthApps: readonly GithubSeedOAuthApp[]
  apps: readonly GithubSeedApp[]
  installations: readonly GithubSeedInstallation[]
  tokens: readonly GithubSeedToken[]
  hooks: readonly GithubSeedHook[]
}>

function account(
  store: Store,
  fields: Pick<GithubAccount, "login" | "type" | "name" | "members" | "emails" | "email">,
) {
  githubStore(store).accounts.insert({
    ghId: nextGhId(store),
    company: null,
    location: null,
    bio: null,
    ...fields,
  })
}

function seedUser(store: Store, user: GithubSeedUser): void {
  const emails = user.emails ?? [`${user.login}@users.noreply.github.com`]

  account(store, {
    login: user.login,
    type: "User",
    name: user.name ?? null,
    members: [],
    email: user.publicEmail ? (emails[0] ?? null) : null,
    emails: emails.map((email, index) => ({
      email,
      primary: index === 0,
      verified: true,
      visibility: index === 0 ? "private" : null,
    })),
  })
}

function requireSeededRepo(gh: GithubStore, fullName: string): GithubRepoRecord {
  const [owner, name] = fullName.split("/")
  const repo = gh.repos.findBy("owner", owner ?? "").find((candidate) => candidate.name === name)

  if (!repo) throw new Error(`seed: repository ${fullName} is not seeded`)

  return repo
}

function seedRepo(store: Store, seed: GithubSeedRepo): void {
  const gh = githubStore(store)
  const [owner = "", name = ""] = seed.repo.split("/")
  const repo = gh.repos.insert({
    ghId: nextGhId(store),
    owner,
    name,
    private: seed.private ?? false,
    description: seed.description ?? null,
    homepage: null,
    defaultBranch: seed.defaultBranch ?? "main",
    archived: false,
    topics: [...(seed.topics ?? [])],
    nextNumber: 1,
  })
  const files = Object.entries(seed.files ?? {})

  if (files.length > 0)
    commitTo(gh, repo, repo.defaultBranch, {
      files: Object.fromEntries(files.map(([path, text]) => [path, Buffer.from(text)])),
      message: "Initial commit",
      author: {
        name: owner,
        email: `${owner}@users.noreply.github.com`,
        date: store.clock().toISOString(),
      },
    })
}

function seedIssue(store: Store, seed: GithubSeedIssue): void {
  const gh = githubStore(store)
  const repo = requireSeededRepo(gh, seed.repo)
  const issue = openIssue(gh, store, repo, {
    title: seed.title,
    body: seed.body ?? null,
    author: seed.author,
    isPull: false,
  })

  gh.issues.update(issue.id, { labels: ensureLabels(gh, store, repo, seed.labels ?? []) })
}

/** A new RSA key in the PKCS#1 PEM GitHub hands out for an app. */
function newAppKey(): string {
  return generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs1", format: "pem" })
    .toString()
}

function seedApp(store: Store, seed: GithubSeedApp): void {
  githubStore(store).apps.insert({
    ghId: seed.id ?? nextGhId(store),
    kind: "github-app",
    slug: seed.slug,
    name: seed.name,
    owner: seed.owner,
    clientId: seed.clientId,
    clientSecret: seed.clientSecret,
    callbackUrls: [...(seed.callbackUrls ?? [])],
    privateKey: seed.privateKey ?? newAppKey(),
    webhookUrl: seed.webhookUrl ?? null,
    webhookSecret: seed.webhookSecret ?? "",
    permissions: { metadata: "read", ...seed.permissions },
    events: [...(seed.events ?? [])],
    expiringUserTokens: seed.expiringUserTokens ?? false,
  })
}

function seedOAuthApp(store: Store, seed: GithubSeedOAuthApp): void {
  githubStore(store).apps.insert({
    ghId: nextGhId(store),
    kind: "oauth-app",
    slug: seed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: seed.name,
    owner: seed.owner ?? "",
    clientId: seed.clientId,
    clientSecret: seed.clientSecret,
    callbackUrls: [...seed.callbackUrls],
    privateKey: "",
    webhookUrl: null,
    webhookSecret: "",
    permissions: {},
    events: [],
    expiringUserTokens: false,
  })
}

/** Records an installation of `seed.app`; returns its id. */
export function addInstallation(store: Store, seed: GithubSeedInstallation) {
  const gh = githubStore(store)
  const app = gh.apps.all().find((candidate) => candidate.slug === seed.app)

  if (!app) throw new Error(`seed: app ${seed.app} is not seeded`)

  return gh.installations.insert({
    ghId: seed.id ?? nextGhId(store),
    appId: app.ghId,
    account: seed.account,
    repositorySelection: seed.repositories ? "selected" : "all",
    repoIds: (seed.repositories ?? []).map(
      (name) => requireSeededRepo(gh, name.includes("/") ? name : `${seed.account}/${name}`).ghId,
    ),
    suspended: false,
  })
}

function seedHook(store: Store, seed: GithubSeedHook): void {
  const gh = githubStore(store)

  gh.hooks.insert({
    ghId: nextGhId(store),
    repoId: requireSeededRepo(gh, seed.repo).id,
    url: seed.url,
    secret: seed.secret ?? "",
    contentType: "json",
    events: [...(seed.events ?? ["push"])],
    active: true,
  })
}

function seedOrg(store: Store, org: GithubSeedOrg): void {
  account(store, {
    login: org.login,
    type: "Organization",
    name: org.name ?? null,
    members: [...(org.members ?? [])],
    email: null,
    emails: [],
  })
}

function seedToken(store: Store, token: GithubSeedToken): void {
  githubStore(store).pats.insert({
    token: token.token,
    login: token.login,
    scopes: [...(token.scopes ?? ["repo", "user"])],
  })
}

/** Seeds each item of `items` with `seed`. */
function each<T>(
  store: Store,
  items: readonly T[] | undefined,
  seed: (store: Store, item: T) => unknown,
) {
  for (const item of items ?? []) seed(store, item)
}

/** Loads `config` into a GitHub emulator's store. No webhooks are sent for seeded data. */
export function seedGithub(store: Store, config: GithubSeedConfig): void {
  each(store, config.users, seedUser)
  each(store, config.orgs, seedOrg)
  each(store, config.repos, seedRepo)
  each(store, config.issues, seedIssue)
  each(store, config.apps, seedApp)
  each(store, config.oauthApps, seedOAuthApp)
  each(store, config.installations, addInstallation)
  each(store, config.hooks, seedHook)
  each(store, config.tokens, seedToken)
}
