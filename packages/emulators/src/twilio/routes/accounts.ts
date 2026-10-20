import type { Context } from "../../http.ts"
import { requireCaller } from "../auth.ts"
import type { TwilioRouteContext } from "../context.ts"
import type { Account, AccountResource, IncomingNumber, PhoneNumber } from "../entities.ts"
import { API_VERSION, boundedInt, notFound } from "../helpers.ts"

/** The lists an account's resource links to, by their `subresource_uris` key, and their paths. */
const SUBRESOURCES: Readonly<Record<string, string>> = {
  addresses: "Addresses",
  applications: "Applications",
  authorized_connect_apps: "AuthorizedConnectApps",
  available_phone_numbers: "AvailablePhoneNumbers",
  balance: "Balance",
  calls: "Calls",
  conferences: "Conferences",
  connect_apps: "ConnectApps",
  incoming_phone_numbers: "IncomingPhoneNumbers",
  keys: "Keys",
  messages: "Messages",
  notifications: "Notifications",
  outgoing_caller_ids: "OutgoingCallerIds",
  queues: "Queues",
  recordings: "Recordings",
  short_codes: "SMS/ShortCodes",
  signing_keys: "SigningKeys",
  sip: "SIP",
  transcriptions: "Transcriptions",
  usage: "Usage",
}

/** The account as the 2010 API answers it, auth token included as Twilio sends it to its owner. */
function accountResource(account: Account): AccountResource {
  const base = `/${API_VERSION}/Accounts/${account.id}`

  return {
    auth_token: account.authToken,
    date_created: account.createdAt,
    date_updated: account.createdAt,
    friendly_name: account.friendlyName,
    owner_account_sid: account.id,
    sid: account.id,
    status: "active",
    subresource_uris: Object.fromEntries(
      Object.entries(SUBRESOURCES).map(([name, path]) => [name, `${base}/${path}.json`]),
    ),
    type: account.type,
    uri: `${base}.json`,
  }
}

/** A number the account owns, with the settings Twilio defaults a new number to. */
function incomingNumber(number: PhoneNumber, account: Account): IncomingNumber {
  const sid = `PN${Buffer.from(number.id).toString("hex").padEnd(32, "0").slice(0, 32)}`

  return {
    account_sid: number.accountSid,
    address_sid: null,
    address_requirements: "none",
    api_version: API_VERSION,
    beta: false,
    capabilities: { voice: true, sms: true, mms: true, fax: false },
    date_created: account.createdAt,
    date_updated: account.createdAt,
    friendly_name: number.id,
    identity_sid: null,
    phone_number: number.id,
    origin: "twilio",
    sid,
    sms_application_sid: null,
    sms_fallback_method: "POST",
    sms_fallback_url: "",
    sms_method: "POST",
    sms_url: number.smsUrl ?? "",
    status_callback: null,
    status_callback_method: "POST",
    trunk_sid: null,
    uri: `/${API_VERSION}/Accounts/${number.accountSid}/IncomingPhoneNumbers/${sid}.json`,
    voice_receive_mode: "voice",
    voice_application_sid: null,
    voice_caller_id_lookup: false,
    voice_fallback_method: "POST",
    voice_fallback_url: "",
    voice_method: "POST",
    voice_url: "",
    emergency_status: "Inactive",
    emergency_address_sid: null,
    emergency_address_status: "unregistered",
    bundle_sid: null,
    status: "in-use",
    type: "local",
  }
}

/** One page of the account's numbers, in the 2010 API's paging shape. */
function numberPage(c: Context, context: TwilioRouteContext): Response {
  const account = requireCaller(c, context.twilio)
  const all = context.twilio.numbers.where((number) => number.accountSid === account.id)
  const size = boundedInt(c.req.query("PageSize"), 50, 1000)
  const page = Number(c.req.query("Page") ?? 0) || 0
  const start = page * size
  const items = all.slice(start, start + size)
  const base = `/${API_VERSION}/Accounts/${account.id}/IncomingPhoneNumbers.json`
  const uriFor = (n: number) => `${base}?PageSize=${size}&Page=${n}`

  return c.json({
    end: start + Math.max(0, items.length - 1),
    first_page_uri: uriFor(0),
    incoming_phone_numbers: items.map((number) => incomingNumber(number, account)),
    next_page_uri: start + size < all.length ? uriFor(page + 1) : null,
    page,
    page_size: size,
    previous_page_uri: page > 0 ? uriFor(page - 1) : null,
    start,
    uri: uriFor(page),
  })
}

/** Reading the account and the numbers it owns: `/2010-04-01/Accounts/{sid}.json` and its numbers. */
export function accountRoutes(context: TwilioRouteContext): void {
  const { app } = context

  app.get(`/${API_VERSION}/Accounts/:file`, (c) => {
    const account = requireCaller(c, context.twilio)

    return c.req.param("file") === `${account.id}.json`
      ? c.json(accountResource(account))
      : notFound(c, `/Accounts/${c.req.param("file")}`)
  })
  app.get(`/${API_VERSION}/Accounts/:account/IncomingPhoneNumbers.json`, (c) =>
    numberPage(c, context),
  )
}
