/** Starts the app: the kit's styles, the frame and the router. */
import "../../kit/kit.css"
import "./app.css"
import { createApp } from "vue"

import App from "./App.vue"
import { router } from "./router.ts"

createApp(App).use(router).mount("#app")
