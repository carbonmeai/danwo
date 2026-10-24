<script lang="ts">
  import { fetchFromApi } from "#lib/browser-api.ts"
  import { type CheckoutResult, money } from "#lib/studio.ts"

  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  /* The server's answer first; the browser's own once it has asked again. */
  let latest = $state<CheckoutResult | null>(null)
  const result = $derived(latest ?? data.result)
  const booking = $derived(result.booking)

  /* Until the booking exists, ask the API from the browser every second. */
  $effect(() => {
    if (booking) return

    const session = encodeURIComponent(data.sessionId)
    const timer = setInterval(() => {
      fetchFromApi<CheckoutResult>(`/checkout/${session}`).then(
        (answer) => {
          latest = answer
        },
        () => undefined,
      )
    }, 1000)

    return () => clearInterval(timer)
  })
</script>

<svelte:head>
  <title>{booking ? "You're booked" : "Confirming"} · Fern Studio</title>
</svelte:head>

{#if booking}
  <header class="page-header">
    <h1 class="page-title">You're booked</h1>
    <p class="page-description">
      A confirmation is on its way to <strong>{booking.email}</strong>.
    </p>
  </header>
  <section class="card booking-card">
    <div class="card-header">
      <h2 class="card-title">{booking.class.name}</h2>
      <p class="card-description">
        {booking.class.starts} · {booking.class.minutes} minutes · with {booking.class.instructor}
      </p>
    </div>
    <div class="card-body">
      <dl class="facts">
        <dt>Booking</dt>
        <dd data-testid="booking-number">{booking.number}</dd>
        <dt>Paid</dt>
        <dd data-testid="booking-total">{money(booking.amount_cents)}</dd>
      </dl>
    </div>
    <div class="card-footer">
      <a class="btn btn-secondary" href="/bookings">My bookings</a>
    </div>
  </section>
{:else}
  <header class="page-header">
    <h1 class="page-title">
      {result.payment === "paid" ? "Confirming your booking…" : "Waiting for your payment…"}
    </h1>
    <p class="page-description">This takes a few seconds. You can keep this page open.</p>
  </header>
{/if}
