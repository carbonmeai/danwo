<script lang="ts">
  import { money } from "#lib/studio.ts"

  import type { PageProps } from "./$types"

  let { data, form }: PageProps = $props()

  const klass = $derived(data.klass)
</script>

<svelte:head>
  <title>{klass.name} · Fern Studio</title>
</svelte:head>

<header class="page-header">
  <h1 class="page-title">{klass.name}</h1>
  <p class="page-description">
    {klass.starts} · {klass.minutes} minutes · with {klass.instructor}
  </p>
</header>
<div class="class-layout">
  <section class="card">
    <div class="card-body stack">
      <p>{klass.description}</p>
      <dl class="facts">
        <dt>Price</dt>
        <dd data-testid="class-price">{money(klass.price_cents)}</dd>
        <dt>Places</dt>
        <dd>
          {#if klass.places_left <= 0}
            <span class="badge badge-danger">Full</span>
          {:else}
            {klass.places_left} of {klass.capacity} left
          {/if}
        </dd>
      </dl>
    </div>
  </section>
  <section class="card">
    <div class="card-header">
      <h2 class="card-title">Book a place</h2>
      <p class="card-description">You pay on Stripe's page, then we email your confirmation.</p>
    </div>
    {#if klass.places_left <= 0}
      <div class="card-body">
        <p class="muted">This class is full. Try another time on the timetable.</p>
      </div>
    {:else}
      <form class="card-body stack" method="post" action="?/book">
        {#if form?.error}
          <div class="toast toast-error" role="alert">
            <span class="toast-text">{form.error}</span>
          </div>
        {/if}
        <div class="field">
          <label class="label" for="email">Email for your confirmation</label>
          <input
            id="email"
            class="input"
            name="email"
            type="email"
            required
            value={form?.email ?? data.email}
            autocomplete="email"
          />
        </div>
        <button class="btn btn-primary" type="submit">
          Book and pay {money(klass.price_cents)}
        </button>
      </form>
    {/if}
  </section>
</div>
