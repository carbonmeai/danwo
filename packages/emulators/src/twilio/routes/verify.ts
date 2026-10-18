import type { Context } from "../../http.ts"
import { isOneOf } from "../../json.ts"
import { requireCaller } from "../auth.ts"
import type { TwilioRouteContext } from "../context.ts"
import type { Account, Verification, VerifyService } from "../entities.ts"
import type { TwilioMessaging } from "../events.ts"
import { checkObject, isLive, serviceObject, verificationObject } from "../formatters.ts"
import { formOf, isE164, iso, notFound, oneTimeCode, twilioError, twilioSid } from "../helpers.ts"

/** How long a code works: Twilio's default of ten minutes. */
const CODE_LIFETIME_MS = 10 * 60 * 1000
/** Wrong codes a verification takes before it refuses further checks. */
const MAX_CHECKS = 5
/** Codes sent to one number within a verification's life before Twilio refuses another. */
const MAX_SENDS = 5

const CHANNELS = ["sms", "call", "email", "whatsapp"] as const

/** The account's Verify service named in the path, or a 404 answer. */
function serviceIn(c: Context, context: TwilioRouteContext): VerifyService | Response {
  const account = requireCaller(c, context.twilio)
  const service = context.twilio.services.get(c.req.param("service"))

  return service?.account_sid === account.id
    ? service
    : notFound(c, `/Services/${c.req.param("service")}`)
}

/** The live, pending verification of `to` in `service`, if any. */
function pendingFor(context: TwilioRouteContext, service: VerifyService, to: string) {
  const now = context.clock()

  return context.twilio.verifications.where((verification) => {
    const extra = context.twilio.verifications.extra(verification.sid)

    return (
      verification.service_sid === service.sid &&
      verification.to === to &&
      verification.status === "pending" &&
      extra !== undefined &&
      isLive(extra, now)
    )
  })[0]
}

/** Texts the code to the phone, as Verify does on the account's behalf. */
function textCode(
  context: TwilioRouteContext,
  messaging: TwilioMessaging,
  account: Account,
  service: VerifyService,
  verification: Verification,
): void {
  const code = context.twilio.verifications.extra(verification.sid)?.code ?? ""

  if (verification.channel !== "sms") return

  messaging.send({
    account,
    from: "Verify",
    to: verification.to,
    body: `Your ${service.friendly_name} verification code is: ${code}`,
    media: [],
    messagingServiceSid: null,
    statusCallback: null,
    viaVerify: true,
  })
}

/** Sends the code again for a pending verification, or refuses after too many sends. */
function resend(
  c: Context,
  context: TwilioRouteContext,
  pending: Verification,
): Verification | Response {
  if (pending.send_code_attempts.length >= MAX_SENDS)
    return twilioError(c, 429, 60203, "Max send attempts reached")

  const attempts = [
    ...pending.send_code_attempts,
    { attempt_sid: twilioSid("VL"), channel: pending.channel, time: iso(context.clock()) },
  ]

  return (
    context.twilio.verifications.change(pending.sid, {
      send_code_attempts: attempts,
      date_updated: iso(context.clock()),
    }) ?? pending
  )
}

async function startVerification(
  c: Context,
  context: TwilioRouteContext,
  messaging: TwilioMessaging,
): Promise<Response> {
  const service = serviceIn(c, context)

  if (service instanceof Response) return service

  const form = await formOf(c)
  const to = form.get("To") ?? ""
  const channel = form.get("Channel") ?? ""

  if (!isOneOf(CHANNELS, channel))
    return twilioError(c, 400, 60200, `Invalid parameter \`Channel\`: ${channel}`)
  if (channel !== "email" && !isE164(to))
    return twilioError(c, 400, 60200, `Invalid parameter \`To\`: ${to}`)

  const account = requireCaller(c, context.twilio)
  const pending = pendingFor(context, service, to)
  const verification = pending
    ? resend(c, context, pending)
    : context.twilio.verifications.add(
        verificationObject({ sid: twilioSid("VE"), service, to, channel, now: context.clock() }),
        {
          code: oneTimeCode(service.code_length),
          checks: 0,
          expiresAt: context.clock().getTime() + CODE_LIFETIME_MS,
        },
      )

  if (verification instanceof Response) return verification
  textCode(context, messaging, account, service, verification)

  return c.json(verification, 201)
}

/** The verification a check names, by its sid or by the number it was sent to. */
function checkedVerification(
  context: TwilioRouteContext,
  service: VerifyService,
  form: URLSearchParams,
): Verification | undefined {
  const sid = form.get("VerificationSid")

  if (sid === null) return pendingFor(context, service, form.get("To") ?? "")

  const verification = context.twilio.verifications.get(sid)
  const extra = context.twilio.verifications.extra(sid)

  return verification?.status === "pending" && extra && isLive(extra, context.clock())
    ? verification
    : undefined
}

async function check(c: Context, context: TwilioRouteContext): Promise<Response> {
  const service = serviceIn(c, context)

  if (service instanceof Response) return service

  const form = await formOf(c)
  const verification = checkedVerification(context, service, form)

  if (verification === undefined) return notFound(c, `/Services/${service.sid}/VerificationCheck`)

  const extra = context.twilio.verifications.extra(verification.sid)

  if (extra === undefined || extra.checks >= MAX_CHECKS)
    return twilioError(c, 429, 60202, "Max check attempts reached")

  const right = form.get("Code") === extra.code
  const now = context.clock()
  const changed = context.twilio.verifications.change(verification.sid, {
    status: right ? "approved" : "pending",
    valid: right,
    date_updated: iso(now),
  })

  context.twilio.verifications.setExtra(verification.sid, { ...extra, checks: extra.checks + 1 })

  return c.json(checkObject(changed ?? verification, now))
}

/** Verify v2: services, verifications that text a code, and checks of the code. */
export function verifyRoutes(context: TwilioRouteContext, messaging: TwilioMessaging): void {
  const { app } = context

  app.post("/v2/Services", async (c) => {
    const account = requireCaller(c, context.twilio)
    const form = await formOf(c)
    const friendlyName = form.get("FriendlyName") ?? ""
    const codeLength = Number(form.get("CodeLength") ?? 6)

    if (friendlyName === "")
      return twilioError(c, 400, 20001, "Missing required parameter FriendlyName in the post body")
    if (!Number.isInteger(codeLength) || codeLength < 4 || codeLength > 10)
      return twilioError(c, 400, 60200, `Invalid parameter \`CodeLength\`: ${codeLength}`)

    const service = serviceObject({
      sid: twilioSid("VA"),
      accountSid: account.id,
      friendlyName,
      codeLength,
      now: context.clock(),
    })

    return c.json(context.twilio.services.add(service, null), 201)
  })
  app.get("/v2/Services/:service", (c) => {
    const service = serviceIn(c, context)

    return service instanceof Response ? service : c.json(service)
  })
  app.post("/v2/Services/:service/Verifications", (c) => startVerification(c, context, messaging))
  app.get("/v2/Services/:service/Verifications/:verification", (c) => {
    const service = serviceIn(c, context)

    if (service instanceof Response) return service

    const key = c.req.param("verification")
    const found = context.twilio.verifications.get(key) ?? pendingFor(context, service, key)

    return found?.service_sid === service.sid ? c.json(found) : notFound(c, `/Verifications/${key}`)
  })
  app.post("/v2/Services/:service/VerificationCheck", (c) => check(c, context))
}
