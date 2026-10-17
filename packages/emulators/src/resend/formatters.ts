import type { DomainRecords } from "resend"

import type { Domain, Email, Region } from "./entities.ts"

/** The DNS records Resend asks a new sending domain to publish. */
function sendingRecords(name: string, region: Region): DomainRecords[] {
  const mailFrom = `send.${name}`

  return [
    {
      record: "SPF",
      name: mailFrom,
      type: "MX",
      ttl: "Auto",
      status: "not_started",
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
    },
    {
      record: "SPF",
      name: mailFrom,
      type: "TXT",
      ttl: "Auto",
      status: "not_started",
      value: "v=spf1 include:amazonses.com ~all",
    },
    {
      record: "DKIM",
      name: `resend._domainkey.${name}`,
      type: "TXT",
      ttl: "Auto",
      status: "not_started",
      value: `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ${Buffer.from(name).toString("base64")}IDAQAB`,
    },
  ]
}

export function domainObject(fields: {
  id: string
  name: string
  region: Region
  createdAt: string
}): Domain {
  return {
    object: "domain",
    id: fields.id,
    name: fields.name,
    status: "not_started",
    region: fields.region,
    created_at: fields.createdAt,
    capabilities: { sending: "enabled", receiving: "disabled" },
    records: sendingRecords(fields.name, fields.region),
  }
}

/** A domain with every record checked, as after a successful verification. */
export function verified(domain: Domain): Partial<Domain> {
  return {
    status: "verified",
    records: domain.records.map((record) => ({ ...record, status: "verified" as const })),
  }
}

/** An email as it appears in a list: without its bodies and tags. */
export function listedEmail(email: Email): Omit<Email, "html" | "text" | "tags" | "object"> {
  const { html: _html, text: _text, tags: _tags, object: _object, ...listed } = email

  return listed
}
