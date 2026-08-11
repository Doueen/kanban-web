<script setup>
import { ref } from "vue";
import { useAppStore } from "../store";

const store = useAppStore();
const user = ref("");
const pass = ref("");
const error = ref("");
const loading = ref(false);

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    const ok = await store.login(user.value.trim(), pass.value);
    if (ok) {
      store.refreshBoard();
      store.loadBoards();
    } else {
      error.value = "用户名或密码错误";
    }
  } catch (_) {
    error.value = "无法连接服务器，请重试";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-screen" role="dialog" aria-modal="true" aria-label="登录">
    <form class="login-card" autocomplete="on" @submit.prevent="submit">
      <div class="login-brand">
        <span class="brand-brackets">⟨</span>
        <span class="brand-name">Hermes Kanban</span>
        <span class="brand-brackets">⟩</span>
      </div>
      <div class="login-sub">终端任务看板 · 请登录</div>

      <van-field
        v-model="user"
        name="username"
        label="用户名"
        placeholder="用户名"
        autocomplete="username"
        clearable
      />
      <van-field
        v-model="pass"
        type="password"
        name="password"
        label="密码"
        placeholder="密码"
        autocomplete="current-password"
        clearable
      />

      <div v-if="error" class="login-error" role="alert">{{ error }}</div>

      <van-button
        type="primary"
        block
        round
        native-type="submit"
        :loading="loading"
        loading-text="验证中…"
        style="margin-top: 4px; min-height: 46px"
      >登录</van-button>
    </form>
  </div>
</template>
