import { createApp } from "vue";
import { createPinia } from "pinia";
import Vant from "vant";
import "vant/lib/index.css";

import App from "./App.vue";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(Vant);
app.mount("#app");
