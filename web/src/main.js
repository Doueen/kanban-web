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

/* PWA：注册 service worker（仅生产/非 localhost 调试时） */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* 产物下载：<a href="/api/download"> 原生导航不带 Authorization 会 401，
   改为 fetch 携带凭据 → blob 下载 */
import { showToast } from "vant";

async function downloadDeliverable(url) {
  const m = url.match(/[?&]path=([^&]+)/);
  if (!m) return;
  const path = decodeURIComponent(m[1]);
  let cred = null;
  try { cred = JSON.parse(localStorage.getItem("kb-auth") || "null"); } catch (_) { /* */ }
  if (!cred || !cred.u) {
    showToast({ message: "请先登录", type: "fail" });
    return;
  }
  try {
    const res = await fetch("/api/download?path=" + encodeURIComponent(path), {
      headers: { Authorization: "Basic " + btoa(cred.u + ":" + cred.p) },
    });
    if (!res.ok) {
      showToast({ message: "下载失败: " + (res.status === 401 ? "未认证" : res.status), type: "fail" });
      return;
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = decodeURIComponent(path).split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
  } catch (err) {
    showToast({ message: "下载失败: " + err.message, type: "fail" });
  }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest?.(".dl-link");
  if (a) {
    e.preventDefault();
    downloadDeliverable(a.href);
  }
});
