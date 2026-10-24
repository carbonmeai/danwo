<script lang="ts">
  import { fetchFromApi } from "#lib/browser-api.ts"
  import { type Booking, money } from "#lib/studio.ts"

  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  /* The server's list first; the browser's own once Refresh has asked the API again. */
  let refreshed = $state<{ readonly email: string; readonly bookings: Booking[] } | null>(null)
  let status = $state("")
  let refreshing = $state(false)

  const bookings = $derived(
    refreshed !== null && refreshed.email === data.email ? refreshed.bookings : data.bookings,
  )

  /** Asks the API for this email's bookings from the browser, without reloading the page. */
  async function refresh(): Promise<void> {
    const email = data.email

    refreshing = true
    try {
      refreshed = {
        email,
        bookings: await fetchFromApi<Booking[]>(`/bookings?email=${encodeURIComponent(email)}`),
      }
      status = "Up to date"
    } catch {
      status = "Couldn't refresh just now. Please try again."
    } finally {
      refreshing = false
    }
  }
</script>

<svelte:head>
  <title>My bookings · Fern Studio</title>
</svelte:head>

<header class="page-header">
  <h1 class="page-title">My bookings</h1>
  <p class="page-description">Every class you've booked, newest first.</p>
</header>
<form class="row bookings-lookup" method="get" action="/bookings">
  <label class="label" for="lookup-email">Email</label>
  <input id="lookup-email" class="input" name="email" type="email" value={data.email} required />
  <button class="btn btn-secondary" type="submit">Show bookings</button>
</form>
{#if bookings.length === 0}
  <div class="empty">
    <p class="empty-title">No bookings yet</p>
    <p class="empty-text">Classes you book show up here.</p>
  </div>
{:else}
  <div class="row bookings-refresh">
    <button class="btn btn-ghost btn-sm" type="button" disabled={refreshing} onclick={refresh}>
      Refresh
    </button>
    <span class="muted" role="status">{status}</span>
  </div>
  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>Booking</th>
          <th>Class</th>
          <th>When</th>
          <th class="num">Paid</th>
          <th>Confirmation</th>
        </tr>
      </thead>
      <tbody>
        {#each bookings as row (row.id)}
          <tr>
            <td>{row.number}</td>
            <td>{row.class.name}</td>
            <td class="muted">{row.class.starts}</td>
            <td class="num">{money(row.amount_cents)}</td>
            <td>
              {#if row.confirmation === "sent"}
                <span class="badge badge-success">Sent</span>
              {:else}
                <span class="badge badge-warning">Pending</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
