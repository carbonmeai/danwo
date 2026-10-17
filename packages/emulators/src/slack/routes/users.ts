import { hasScope } from "../auth.ts"
import type { ApiCall, Methods } from "../context.ts"
import type { UserRecord } from "../entities.ts"
import { userObject } from "../formatters.ts"
import { paginate, requireArg, SlackApiError, unixNow } from "../helpers.ts"
import { requireUser, teamOf } from "../lookup.ts"

/** A member as this call may see them: emails only with `users:read.email`. */
function view(call: ApiCall, user: UserRecord) {
  const team = teamOf(call.context.slack)

  return userObject(user, team, hasScope(call.token, "users:read.email"))
}

function listMethod(call: ApiCall) {
  const page = paginate(call.context.slack.users.all(), call.args)

  return {
    members: page.items.map((user) => view(call, user)),
    cache_ts: unixNow(call.context.clock),
    response_metadata: { next_cursor: page.nextCursor },
  }
}

function lookupByEmailMethod(call: ApiCall) {
  const email = requireArg(call.args, "email", "users_not_found").toLowerCase()
  const user = call.context.slack.users
    .all()
    .find((candidate) => candidate.email?.toLowerCase() === email && !candidate.deleted)

  if (!user) throw new SlackApiError("users_not_found")

  return { user: view(call, user) }
}

/** `users.list`, `users.info` and `users.lookupByEmail`. */
export const userMethods: Methods = {
  "users.list": { scopes: ["users:read"], run: listMethod },
  "users.info": {
    scopes: ["users:read"],
    run: (call) => ({
      user: view(
        call,
        requireUser(call.context.slack, requireArg(call.args, "user", "user_not_found")),
      ),
    }),
  },
  "users.lookupByEmail": { scopes: ["users:read.email"], run: lookupByEmailMethod },
}
