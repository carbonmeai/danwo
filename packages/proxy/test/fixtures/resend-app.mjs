/*
 * An app under test that knows nothing about the proxy: the official Resend client with its
 * default base URL (https://api.resend.com). Prints what it saw as JSON.
 */
import { Resend } from "resend"

const out = {}
const resend = new Resend("re_from_app")
const { data, error } = await resend.emails.send({
  from: "App <app@danwo.test>",
  to: "new-user@example.com",
  subject: "Your sign-in code",
  text: "Your code is 734120",
})

out.id = data?.id
out.error = error?.message
console.log(JSON.stringify(out))
