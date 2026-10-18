/*
 * An app under test that knows nothing about the proxy: the official Twilio client with its
 * default hosts. It starts a phone verification, waits for the person to type the code they got
 * (a line on stdin), checks it, and prints what Twilio answered as JSON.
 */
import { createInterface } from "node:readline"

import twilio from "twilio"

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
const verify = client.verify.v2.services(process.env.VERIFY_SERVICE ?? "")
const phone = process.env.PHONE ?? ""
const started = await verify.verifications.create({ to: phone, channel: "sms" })

console.log(JSON.stringify({ sent: started.status }))

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
const typed: string = (await lines.next()).value ?? ""
const wrong = await verify.verificationChecks.create({ to: phone, code: "000000" })
const right = await verify.verificationChecks.create({ to: phone, code: typed })

console.log(JSON.stringify({ wrong: wrong.status, right: right.status }))
process.exit(0)
