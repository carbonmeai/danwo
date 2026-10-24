<script setup lang="ts">
/**
 * Where Stripe sends the browser after the team pays. The plan starts when Stripe's webhook
 * reaches the API, which may be a moment after the browser does, so the page asks the API again
 * every second until the plan is active, then shows the account.
 */
import { onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"

import PlanCard from "../components/PlanCard.vue"
import { account, refreshSession } from "../session.ts"

/** How often to ask whether the plan has started. */
const POLL_MS = 1_000

const router = useRouter()
const error = ref("")
let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false

async function check() {
  try {
    const signedIn = await refreshSession()

    error.value = ""
    if (signedIn === null) return await router.replace("/")
    if (signedIn.plan === "team") return await router.replace("/account")
  } catch {
    /* The API did not answer this time, even after its retries; keep asking. */
    error.value = "Quillwork is not answering just now. Still trying…"
  }
  if (!stopped) timer = setTimeout(check, POLL_MS)
}

onMounted(check)
onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
})
</script>

<template>
  <PlanCard :account="account" :error="error" confirming />
</template>
