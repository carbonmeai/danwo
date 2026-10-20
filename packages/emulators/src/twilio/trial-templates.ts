/**
 * The message templates a Twilio trial account must send. A trial account cannot write its own
 * text: its `Body` names one of these template ids, and the message carries the template's text.
 * `sms_internal_alerts` is the text Twilio sends; the others stand in for theirs, ending as Twilio's
 * do, so an app sees a template's text where it sent an id.
 */
const ENDING = "Test message from Twilio."

const TEXTS: Readonly<Record<string, string>> = {
  sms_2fa: `Your verification code is 123456. It expires in 10 minutes. ${ENDING}`,
  sms_appointment_reminders: `Reminder: you have an appointment tomorrow at 10:00 AM. Reply C to confirm. ${ENDING}`,
  sms_order_confirmation: `Your order has been confirmed and is being prepared. ${ENDING}`,
  sms_delivery_updates: `Your package is out for delivery and will arrive today. ${ENDING}`,
  sms_customer_support: `Thanks for contacting support. An agent will reply shortly. ${ENDING}`,
  sms_marketing_promotions: `Save 20% on your next order this week. Reply STOP to opt out. ${ENDING}`,
  sms_event_notifications: `Your event starts in one hour. See you there. ${ENDING}`,
  sms_account_alerts: `A new sign-in to your account was detected. ${ENDING}`,
  sms_feedback_surveys: `How did we do? Reply with a rating from 1 to 5. ${ENDING}`,
  sms_internal_alerts: `Alert: System downtime detected. Engineers notified. ETA to resolution: 2 hours. Reply STATUS for updates. ${ENDING}`,
}

/** The template ids a trial account may send. */
export const TRIAL_TEMPLATES: readonly string[] = Object.keys(TEXTS)

/** The text a trial account's message carries for template `id`, or undefined for an unknown id. */
export function trialTemplateText(id: string): string | undefined {
  return TEXTS[id]
}
