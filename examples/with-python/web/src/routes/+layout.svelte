<script lang="ts">
  import "../../../kit/kit.css"
  import "../studio.css"

  import type { Snippet } from "svelte"

  import { page } from "$app/state"

  let { children }: { children: Snippet } = $props()

  const onBookings = $derived(page.url.pathname.startsWith("/bookings"))
  const crumb = $derived(
    page.error
      ? "Not found"
      : typeof page.data.crumb === "string"
        ? page.data.crumb
        : "Timetable",
  )
</script>

<div class="shell">
  <aside class="shell-sidebar">
    <div class="shell-brand">
      <span class="shell-logo" aria-hidden="true">F</span>
      Fern Studio
    </div>
    <nav class="shell-nav" aria-label="Main">
      <span class="shell-nav-label">Studio</span>
      <a href="/" aria-current={onBookings ? undefined : "page"}>Timetable</a>
      <a href="/bookings" aria-current={onBookings ? "page" : undefined}>My bookings</a>
    </nav>
    <p class="shell-sidebar-footer">Tested with danwo</p>
  </aside>
  <div class="shell-main">
    <header class="shell-topbar">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <span>Fern Studio</span>
        <span aria-current="page">{crumb}</span>
      </nav>
      <span class="badge badge-info">This week</span>
    </header>
    <main class="shell-content">{@render children()}</main>
  </div>
</div>
