<script setup lang="ts">
/**
 * The team's name and its plan card. On the Team plan it shows the plan as active; while a payment
 * is being confirmed, that it is; on the free plan, whatever the page puts in its `free` slot.
 */
import type { Account } from "../api.ts"

defineProps<{
  /** The account, undefined while it loads. */
  readonly account: Account | null | undefined
  /** An error to show above the plan. */
  readonly error?: string
  /** Whether a payment is being confirmed: Stripe took it, its webhook has not landed yet. */
  readonly confirming?: boolean
}>()
</script>

<template>
  <div v-if="account" class="page-header">
    <h1 class="page-title">{{ account.team }}</h1>
    <p class="page-description">Signed in as {{ account.email }}</p>
  </div>

  <section class="card narrow" aria-labelledby="plan-title">
    <div class="card-header">
      <h2 id="plan-title" class="card-title">Plan</h2>
    </div>
    <div class="card-body stack">
      <p v-if="error" class="toast toast-error" role="alert">{{ error }}</p>
      <p v-if="!account" role="status" aria-busy="true" class="muted">Loading your plan…</p>
      <template v-else-if="account.plan === 'team'">
        <div class="row">
          <span class="price" data-testid="plan-name">Team</span>
          <span class="badge badge-success" data-testid="plan-status">Active</span>
        </div>
        <p class="muted">$24 a month, billed by Stripe. Unlimited notes and members.</p>
      </template>
      <template v-else-if="confirming">
        <p role="status" aria-busy="true">Confirming your payment…</p>
        <p class="muted">This takes a few seconds. You can keep this page open.</p>
      </template>
      <template v-else>
        <div class="row">
          <span class="price" data-testid="plan-name">Free</span>
          <span v-if="account.status" class="badge badge-warning" data-testid="plan-status">
            Team plan {{ account.status }}
          </span>
        </div>
        <p class="muted">Move to the Team plan for unlimited notes and members: $24 a month.</p>
        <slot name="free" />
      </template>
    </div>
  </section>
</template>
