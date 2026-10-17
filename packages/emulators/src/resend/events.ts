import type {
  DomainCreatedEvent,
  DomainDeletedEvent,
  EmailDeliveredEvent,
  EmailScheduledEvent,
  EmailSentEvent,
} from "resend"

import type { Outbox } from "../outbox.ts"
import type { Clock } from "../store.ts"
import type { Domain, Email } from "./entities.ts"

type EmailEvent = EmailSentEvent | EmailScheduledEvent | EmailDeliveredEvent
type DomainEvent = DomainCreatedEvent | DomainDeletedEvent

/** Queues Resend webhook events. Resend's events carry no id; the body is the event itself. */
export class ResendEvents {
  private readonly outbox: Outbox
  private readonly clock: Clock

  constructor(outbox: Outbox, clock: Clock) {
    this.outbox = outbox
    this.clock = clock
  }

  email(type: EmailEvent["type"], email: Email): void {
    const tags = email.tags ?? []
    const event: EmailEvent = {
      type,
      created_at: this.now(),
      data: {
        created_at: email.created_at,
        email_id: email.id,
        message_id: email.message_id,
        from: email.from,
        to: email.to,
        subject: email.subject,
        ...(tags.length > 0 && {
          tags: Object.fromEntries(tags.map((tag) => [tag.name, tag.value])),
        }),
      },
    }

    this.outbox.push(type, event)
  }

  // fallow-ignore-next-line unused-class-member -- called through a destructured route context
  domain(type: DomainEvent["type"], domain: Domain): void {
    const event: DomainEvent = {
      type,
      created_at: this.now(),
      data: {
        id: domain.id,
        name: domain.name,
        status: domain.status,
        created_at: domain.created_at,
        region: domain.region,
        records: domain.records,
      },
    }

    this.outbox.push(type, event)
  }

  private now(): string {
    return this.clock().toISOString()
  }
}
