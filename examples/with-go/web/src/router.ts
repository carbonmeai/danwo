/** The app's pages, by path. Go serves index.html for each, so any of them loads directly. */
import { createRouter, createWebHistory } from "vue-router"

import AccountPage from "./pages/AccountPage.vue"
import CheckoutReturnPage from "./pages/CheckoutReturnPage.vue"
import PlansPage from "./pages/PlansPage.vue"

declare module "vue-router" {
  interface RouteMeta {
    /** The page's name, in the tab's title and the breadcrumb. */
    readonly title: string
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: PlansPage, meta: { title: "Plans" } },
    { path: "/account", component: AccountPage, meta: { title: "Account" } },
    /* Where Stripe sends the browser once the team has paid. */
    { path: "/checkout/return", component: CheckoutReturnPage, meta: { title: "Account" } },
    { path: "/:rest(.*)*", redirect: "/" },
  ],
})

router.afterEach((to) => {
  document.title = `${to.meta.title} · Quillwork`
})
