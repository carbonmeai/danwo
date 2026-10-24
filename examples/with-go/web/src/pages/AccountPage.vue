<script setup lang="ts">
/** The team's account: its plan, and the button that starts Stripe Checkout for the Team plan. */
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"

import { ApiError, startCheckout } from "../api.ts"
import PlanCard from "../components/PlanCard.vue"
import { account, refreshSession } from "../session.ts"

const router = useRouter()
const error = ref("")
const starting = ref(false)

async function load() {
  error.value = ""
  try {
    if ((await refreshSession()) === null) await router.replace("/")
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
  }
}

/** Sends the browser to Stripe's page; the button stays busy until it has gone. */
async function upgrade() {
  starting.value = true
  error.value = ""
  try {
    window.location.assign(await startCheckout())
  } catch (failure) {
    starting.value = false
    /* Already on the plan, from a checkout in another tab: show it. */
    if (failure instanceof ApiError && failure.status === 409) await load()
    else error.value = failure instanceof Error ? failure.message : String(failure)
  }
}

onMounted(load)
</script>

<template>
  <PlanCard :account="account" :error="error">
    <template #free>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="starting"
        :aria-busy="starting"
        @click="upgrade"
      >
        Upgrade to Team
      </button>
    </template>
  </PlanCard>
</template>
