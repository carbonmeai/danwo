<script setup lang="ts">
/** The plans, and the sign-up form for a team that has no account yet. */
import { reactive, ref } from "vue"
import { RouterLink, useRouter } from "vue-router"

import { ApiError, signUp } from "../api.ts"
import { account } from "../session.ts"

const router = useRouter()
const form = reactive({ email: "", team: "" })
const fields = ref<Readonly<Record<string, string>>>({})
const error = ref("")
const sending = ref(false)

async function submit() {
  sending.value = true
  error.value = ""
  try {
    account.value = await signUp(form)
    await router.push("/account")
  } catch (failure) {
    fields.value = failure instanceof ApiError ? failure.fields : {}
    if (Object.keys(fields.value).length === 0)
      error.value = failure instanceof Error ? failure.message : String(failure)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="page-header">
    <h1 class="page-title">Notes your whole team can find</h1>
    <p class="page-description">Start free. Move to the Team plan when everyone joins.</p>
  </div>

  <div class="plans">
    <section class="card" aria-labelledby="plan-free">
      <div class="card-header">
        <h2 id="plan-free" class="card-title">Free</h2>
        <p class="card-description">For trying Quillwork with a few people</p>
      </div>
      <div class="card-body"><span class="price">$0</span> <span class="muted">a month</span></div>
    </section>
    <section class="card" aria-labelledby="plan-team">
      <div class="card-header">
        <h2 id="plan-team" class="card-title">Team</h2>
        <p class="card-description">Unlimited notes and members</p>
      </div>
      <div class="card-body"><span class="price">$24</span> <span class="muted">a month</span></div>
    </section>
  </div>

  <p v-if="account">
    <RouterLink class="btn btn-primary" to="/account">Go to your account</RouterLink>
  </p>
  <section v-else class="card narrow" aria-labelledby="signup-title">
    <div class="card-header">
      <h2 id="signup-title" class="card-title">Create your team's account</h2>
    </div>
    <form class="card-body stack" novalidate @submit.prevent="submit">
      <p v-if="error" class="toast toast-error" role="alert">{{ error }}</p>
      <div class="field">
        <label class="label" for="email">Work email</label>
        <input
          id="email"
          v-model="form.email"
          name="email"
          class="input"
          type="email"
          autocomplete="email"
          :aria-invalid="fields.email ? 'true' : undefined"
          :aria-describedby="fields.email ? 'email-error' : undefined"
        />
        <p v-if="fields.email" id="email-error" class="error">{{ fields.email }}</p>
      </div>
      <div class="field">
        <label class="label" for="team">Team name</label>
        <input
          id="team"
          v-model="form.team"
          name="team"
          class="input"
          type="text"
          :aria-invalid="fields.team ? 'true' : undefined"
          :aria-describedby="fields.team ? 'team-error' : undefined"
        />
        <p v-if="fields.team" id="team-error" class="error">{{ fields.team }}</p>
      </div>
      <button type="submit" class="btn btn-primary" :disabled="sending" :aria-busy="sending">
        Create account
      </button>
    </form>
  </section>
</template>
