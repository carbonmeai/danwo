<script setup lang="ts">
/** The app's frame: the sidebar, the top bar with sign-out, and the page the path names. */
import { onMounted } from "vue"
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router"

import { signOut } from "./api.ts"
import { account, refreshSession } from "./session.ts"

const route = useRoute()
const router = useRouter()

onMounted(() => {
  /* A page that needs the account asks for it itself; this fills in the frame. */
  if (account.value === undefined) refreshSession().catch(() => undefined)
})

/** Signs out and goes to the plans; when the API can't be reached, the browser stays signed in. */
async function leave() {
  try {
    await signOut()
  } catch {
    return
  }
  account.value = null
  await router.push("/")
}
</script>

<template>
  <div class="shell">
    <aside class="shell-sidebar">
      <div class="shell-brand"><span class="shell-logo" aria-hidden="true">Q</span>Quillwork</div>
      <nav class="shell-nav" aria-label="Main">
        <RouterLink to="/" :aria-current="route.path === '/' ? 'page' : undefined"
          >Plans</RouterLink
        >
        <RouterLink
          v-if="account"
          to="/account"
          :aria-current="route.path === '/account' ? 'page' : undefined"
        >
          Account
        </RouterLink>
      </nav>
      <div class="shell-sidebar-footer">Team notes, written together</div>
    </aside>
    <main class="shell-main">
      <header class="shell-topbar">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <span>Quillwork</span><span aria-current="page">{{ route.meta.title }}</span>
        </nav>
        <button v-if="account" type="button" class="btn btn-ghost btn-sm" @click="leave">
          Sign out
        </button>
      </header>
      <div class="shell-content"><RouterView /></div>
    </main>
  </div>
</template>
