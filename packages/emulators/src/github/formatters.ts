import type { components } from "@octokit/openapi-types"

import type {
  GithubAccount,
  GithubAppRecord,
  GithubInstallationRecord,
  GithubRepoRecord,
} from "./entities.ts"
import { API, ghTime, nodeId, WEB } from "./helpers.ts"
import type { GithubStore } from "./store.ts"

type Schemas = components["schemas"]

/** The ids GitHub shows for an app's bot account are derived from the app's. */
const botId = (app: GithubAppRecord) => 41_000_000 + app.ghId

/** The URL templates every account object carries. */
function accountUrls(login: string) {
  const url = `${API}/users/${login}`

  return {
    url,
    html_url: `${WEB}/${login.replace(/\[bot\]$/, "")}`,
    followers_url: `${url}/followers`,
    following_url: `${url}/following{/other_user}`,
    gists_url: `${url}/gists{/gist_id}`,
    starred_url: `${url}/starred{/owner}{/repo}`,
    subscriptions_url: `${url}/subscriptions`,
    organizations_url: `${url}/orgs`,
    repos_url: `${url}/repos`,
    events_url: `${url}/events{/privacy}`,
    received_events_url: `${url}/received_events`,
  }
}

function accountShape(login: string, id: number, type: "User" | "Organization" | "Bot") {
  return {
    login,
    id,
    node_id: nodeId(type === "Organization" ? "O" : "U", id),
    avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4`,
    gravatar_id: "",
    ...accountUrls(login),
    type,
    user_view_type: "public",
    site_admin: false,
  } satisfies Schemas["simple-user"]
}

/** A person or organisation as nested in other objects. */
export function simpleUser(account: GithubAccount) {
  return accountShape(account.login, account.ghId, account.type)
}

/**
 * The account object for `login`: a stored person or organisation, an app's `slug[bot]` account,
 * or GitHub's placeholder `ghost` for anyone else.
 */
export function userByLogin(gh: GithubStore, login: string) {
  const account = gh.accounts.findOneBy("login", login)

  if (account) return simpleUser(account)

  const app = gh.apps.all().find((candidate) => `${candidate.slug}[bot]` === login)

  if (app) return accountShape(login, botId(app), "Bot")

  return login === WEB_FLOW.login
    ? accountShape(WEB_FLOW.login, WEB_FLOW.id, "User")
    : accountShape("ghost", 10_137, "User")
}

/** The account GitHub commits as when it signs a commit made through the API. */
export const WEB_FLOW = {
  login: "web-flow",
  id: 19_864_447,
  name: "GitHub",
  email: "noreply@github.com",
} as const

/** The address an app's bot account commits with: `<id>+<slug>[bot]@users.noreply.github.com`. */
export function botEmail(gh: GithubStore, login: string): string {
  const app = gh.apps.all().find((candidate) => `${candidate.slug}[bot]` === login)

  return app
    ? `${botId(app)}+${login}@users.noreply.github.com`
    : `${login}@users.noreply.github.com`
}

/** The login an address belongs to: a person's, an app bot's, or GitHub's own; else none. */
export function loginForEmail(gh: GithubStore, email: string): string | undefined {
  const account = gh.accounts.all().find((a) => a.emails.some((e) => e.email === email))

  if (account) return account.login
  if (email === WEB_FLOW.email) return WEB_FLOW.login

  return /^\d+\+(.+\[bot\])@users\.noreply\.github\.com$/.exec(email)?.[1]
}

function primaryEmail(account: GithubAccount): string | null {
  return account.emails.find((email) => email.primary)?.email ?? account.email
}

/** `GET /user`: the signed-in person, with what only they see. */
export function privateUser(gh: GithubStore, account: GithubAccount) {
  const owned = gh.repos.findBy("owner", account.login)
  const privateRepos = owned.filter((repo) => repo.private).length

  return {
    ...simpleUser(account),
    name: account.name,
    company: account.company,
    blog: "",
    location: account.location,
    email: account.email,
    notification_email: primaryEmail(account),
    hireable: null,
    bio: account.bio,
    twitter_username: null,
    public_repos: owned.length - privateRepos,
    public_gists: 0,
    followers: 0,
    following: 0,
    created_at: ghTime(account.created_at),
    updated_at: ghTime(account.updated_at),
    private_gists: 0,
    total_private_repos: privateRepos,
    owned_private_repos: privateRepos,
    disk_usage: 0,
    collaborators: 0,
    two_factor_authentication: true,
    plan: { name: "free", space: 976_562_499, private_repos: 10_000, collaborators: 0 },
  } satisfies Schemas["private-user"]
}

/**
 * The API URL templates every repository object carries, as one space-separated list: `name`
 * gives `name_url` at `/repos/{owner}/{repo}/name`, and `name=path` puts it at `path` instead.
 */
const REPO_PATHS =
  "forks teams hooks events tags languages stargazers contributors subscribers subscription merges downloads deployments keys=keys{/key_id} collaborators=collaborators{/collaborator} issue_events=issues/events{/number} assignees=assignees{/user} branches=branches{/branch} blobs=git/blobs{/sha} git_tags=git/tags{/sha} git_refs=git/refs{/sha} trees=git/trees{/sha} statuses=statuses/{sha} commits=commits{/sha} git_commits=git/commits{/sha} comments=comments{/number} issue_comment=issues/comments{/number} contents=contents/{+path} compare=compare/{base}...{head} archive={archive_format}{/ref} issues=issues{/number} pulls=pulls{/number} milestones=milestones{/number} notifications=notifications{?since,all,participating} labels=labels{/name} releases=releases{/id}" as const

/** The names in a space-separated list. */
type Words<S extends string> = S extends `${infer Head} ${infer Rest}` ? Head | Words<Rest> : S

type RepoUrlField =
  `${Words<typeof REPO_PATHS> extends infer W ? (W extends `${infer N}=${string}` ? N : W) : never}_url`

/** The URLs every repository object carries: the API templates, and where to browse and clone. */
function repoUrls(fullName: string) {
  const url = `${API}/repos/${fullName}`
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the entries are built from REPO_PATHS, whose names RepoUrlField is derived from
  const templates = Object.fromEntries(
    REPO_PATHS.split(" ").map((word) => {
      const [field = word, path = word] = word.split("=")

      return [`${field}_url`, `${url}/${path}`]
    }),
  ) as Record<RepoUrlField, string>

  return {
    ...templates,
    url,
    html_url: `${WEB}/${fullName}`,
    git_url: `git://github.com/${fullName}.git`,
    ssh_url: `git@github.com:${fullName}.git`,
    clone_url: `${WEB}/${fullName}.git`,
    svn_url: `${WEB}/${fullName}`,
    mirror_url: null,
  }
}

/** The counts and switches every repository object carries. */
function repoSettings(repo: GithubRepoRecord) {
  return {
    homepage: repo.homepage,
    size: 0,
    stargazers_count: 0,
    watchers_count: 0,
    language: null,
    has_issues: true,
    has_projects: true,
    has_downloads: true,
    has_wiki: true,
    has_pages: false,
    has_discussions: false,
    has_pull_requests: true,
    pull_request_creation_policy: "all" as const,
    forks_count: 0,
    archived: repo.archived,
    disabled: false,
    open_issues_count: 0,
    license: null,
    allow_forking: true,
    is_template: false,
    web_commit_signoff_required: false,
    topics: repo.topics,
    visibility: repo.private ? "private" : "public",
    forks: 0,
    open_issues: 0,
    watchers: 0,
    default_branch: repo.defaultBranch,
  }
}

/** The merge settings a repository shows to callers who may push to it. */
const MERGE_SETTINGS = {
  allow_squash_merge: true,
  allow_merge_commit: true,
  allow_rebase_merge: true,
  allow_auto_merge: false,
  delete_branch_on_merge: false,
  allow_update_branch: false,
  use_squash_pr_title_as_default: false,
  squash_merge_commit_message: "COMMIT_MESSAGES",
  squash_merge_commit_title: "COMMIT_OR_PR_TITLE",
  merge_commit_message: "PR_TITLE",
  merge_commit_title: "MERGE_MESSAGE",
} satisfies Partial<Schemas["full-repository"]>

/**
 * Where a repository is shown, and what the caller may do with it:
 * - `full`, as `GET /repos/{owner}/{repo}` answers: with its network and subscriber counts, its
 *   organisation and custom properties when an organisation owns it, the caller's permissions and
 *   a clone token when the caller is signed in, and the merge settings when the caller may push;
 * - `listed`, as a list of repositories shows each: the caller's permissions, and custom properties
 *   for an organisation's repository;
 * - `nested`, inside another object such as an installation token or a pull request's head: none
 *   of those.
 */
export interface RepoView {
  readonly as: "full" | "listed" | "nested"
  readonly access: "anonymous" | "read" | "push"
}

/** How a repository is shown where nothing says otherwise: in full, to someone who may push. */
const FULL_PUSH: RepoView = { as: "full", access: "push" }

/** What an organisation's repository adds: its custom properties, and in full the organisation. */
function orgFields(gh: GithubStore, repo: GithubRepoRecord, view: RepoView) {
  const owner = gh.accounts.findOneBy("login", repo.owner)

  if (owner?.type !== "Organization" || view.as === "nested") return {}

  return {
    custom_properties: {},
    ...(view.as === "full" && { organization: simpleUser(owner) }),
  } satisfies Partial<Schemas["full-repository"]>
}

/** What a signed-in caller sees: their permissions, and in full a clone token and the counts. */
function callerFields(view: RepoView) {
  const signedIn = view.access !== "anonymous"
  const full = view.as === "full"

  return {
    ...(signedIn &&
      view.as !== "nested" && {
        permissions: { admin: true, maintain: true, push: true, triage: true, pull: true },
      }),
    ...(signedIn && full && { temp_clone_token: "" }),
    ...(full && view.access === "push" && MERGE_SETTINGS),
    ...(full && { network_count: 0, subscribers_count: 0 }),
  } satisfies Partial<Schemas["full-repository"]>
}

/** A repository, shown as `view` says: in full, in a list, or nested in another object. */
export function repositoryObject(
  gh: GithubStore,
  repo: GithubRepoRecord,
  view: RepoView = FULL_PUSH,
) {
  const fullName = `${repo.owner}/${repo.name}`

  return {
    id: repo.ghId,
    node_id: nodeId("R", repo.ghId),
    name: repo.name,
    full_name: fullName,
    private: repo.private,
    owner: userByLogin(gh, repo.owner),
    description: repo.description,
    fork: false,
    ...repoUrls(fullName),
    ...repoSettings(repo),
    pushed_at: ghTime(repo.updated_at),
    created_at: ghTime(repo.created_at),
    updated_at: ghTime(repo.updated_at),
    ...callerFields(view),
    ...orgFields(gh, repo, view),
  } satisfies Partial<Schemas["full-repository"]>
}

/**
 * A GitHub App as `GET /app` shows it, with how many installations it has; nested in a check run
 * or a comment it was made through, the count is left out.
 */
export function appObject(gh: GithubStore, app: GithubAppRecord, nested = false) {
  const shown = {
    id: app.ghId,
    slug: app.slug,
    node_id: nodeId("A", app.ghId),
    client_id: app.clientId,
    owner: userByLogin(gh, app.owner),
    name: app.name,
    description: app.description,
    external_url: `${WEB}/apps/${app.slug}`,
    html_url: `${WEB}/apps/${app.slug}`,
    created_at: ghTime(app.created_at),
    updated_at: ghTime(app.updated_at),
    permissions: app.permissions,
    events: app.events,
  } satisfies Schemas["integration"]

  return nested
    ? shown
    : { ...shown, installations_count: gh.installations.findBy("appId", app.ghId).length }
}

/** An installation of an app on an account. */
export function installationObject(gh: GithubStore, installation: GithubInstallationRecord) {
  const app = gh.apps.findOneBy("ghId", installation.appId)
  const account = userByLogin(gh, installation.account)

  return {
    id: installation.ghId,
    client_id: app?.clientId ?? "",
    account,
    repository_selection: installation.repositorySelection,
    access_tokens_url: `${API}/app/installations/${installation.ghId}/access_tokens`,
    repositories_url: `${API}/installation/repositories`,
    html_url: `${WEB}/settings/installations/${installation.ghId}`,
    app_id: installation.appId,
    app_slug: app?.slug ?? "",
    target_id: account.id,
    target_type: account.type,
    permissions: app?.permissions ?? {},
    events: app?.events ?? [],
    created_at: ghTime(installation.created_at),
    updated_at: ghTime(installation.updated_at),
    single_file_name: null,
    has_multiple_single_files: false,
    single_file_paths: [],
    suspended_by: null,
    suspended_at: null,
  } satisfies Schemas["installation"]
}
