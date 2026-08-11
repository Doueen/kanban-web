import { createApp } from "vue";
import { createPinia } from "pinia";
import Vant from "vant";
import "vant/lib/index.css";

import App from "./App.vue";
import "./style.css";

const app = createApp(App);
app.config.errorHandler = (err, _instance, info) => {
  const msg = `${info}: ${err && err.message ? err.message : err}`;
  console.error("[vue-error]", msg);
  window.__vueErr = (window.__vueErr || []).concat([msg]);
};
app.use(createPinia());
app.use(Vant);
app.mount("#app");
