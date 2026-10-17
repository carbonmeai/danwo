import type { Entity, Store } from "../store.ts"
import type {
  AppRecord,
  ChannelRecord,
  EphemeralRecord,
  FileRecord,
  IncomingWebhookRecord,
  InstallationRecord,
  InstallCode,
  MessageRecord,
  PendingInstall,
  ResponseUrlRecord,
  ScheduledRecord,
  TeamRecord,
  TokenRecord,
  TriggerRecord,
  UserRecord,
  ViewRecord,
} from "./entities.ts"

/** The Slack records held in an emulator's store, each collection indexed by the fields it is looked up by. */
export function slackStore(store: Store) {
  const of = <T extends Entity>(name: string, ...indexed: (keyof T)[]) =>
    store.collection<T>(`slack.${name}`, indexed)

  return {
    teams: of<TeamRecord>("teams", "teamId"),
    users: of<UserRecord>("users", "userId", "email"),
    channels: of<ChannelRecord>("channels", "channelId", "name"),
    messages: of<MessageRecord>("messages", "channel", "ts"),
    ephemeral: of<EphemeralRecord>("ephemeral", "channel"),
    apps: of<AppRecord>("apps", "appId", "clientId"),
    installations: of<InstallationRecord>("installations", "appId"),
    tokens: of<TokenRecord>("tokens", "token", "refreshToken"),
    pending: of<PendingInstall>("pending", "requestId"),
    codes: of<InstallCode>("codes", "code"),
    webhooks: of<IncomingWebhookRecord>("webhooks", "path"),
    responseUrls: of<ResponseUrlRecord>("response_urls", "path"),
    triggers: of<TriggerRecord>("triggers", "triggerId"),
    views: of<ViewRecord>("views", "viewId", "externalId"),
    files: of<FileRecord>("files", "fileId"),
    scheduled: of<ScheduledRecord>("scheduled", "scheduledId"),
  }
}

export type SlackStore = ReturnType<typeof slackStore>
