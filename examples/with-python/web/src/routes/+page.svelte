<script lang="ts">
  import { money, placesLeft, placesTone } from "#lib/studio.ts"

  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
</script>

<svelte:head>
  <title>Fern Studio</title>
</svelte:head>

<header class="page-header">
  <h1 class="page-title">This week's classes</h1>
  <p class="page-description">
    Small classes, booked and paid ahead. Your confirmation comes by email.
  </p>
</header>
<ul class="timetable">
  {#each data.classes as klass (klass.slug)}
    <li>
      <a class="card class-card" href="/classes/{klass.slug}">
        <span class="class-when">{klass.starts} · {klass.minutes} min</span>
        <span class="card-title">{klass.name}</span>
        <span class="muted">with {klass.instructor}</span>
        <span class="row class-meta">
          <strong>{money(klass.price_cents)}</strong>
          <span class="badge {placesTone(klass)}">{placesLeft(klass)}</span>
        </span>
      </a>
    </li>
  {/each}
</ul>
