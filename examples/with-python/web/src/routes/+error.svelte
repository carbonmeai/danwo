<script lang="ts">
  import { page } from "$app/state"
</script>

<svelte:head>
  <title>{page.status === 404 ? "Not found" : "Something went wrong"} · Fern Studio</title>
</svelte:head>

<div class="empty">
  {#if page.status === 404}
    <p class="empty-title">Nothing here</p>
    <p class="empty-text">That page doesn't exist. <a href="/">See the timetable</a>.</p>
  {:else}
    <p class="empty-title">Something went wrong</p>
    <p class="empty-text">{page.error?.message} <a href="/">See the timetable</a>.</p>
  {/if}
</div>
