<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { THEMES, useAppStore } from "../store";
import { ok, COPY } from "../feedback";

const store = useAppStore();
const show = ref(false);

const isMobile = computed(() => store.isMobile);

/* 移动端：van-action-sheet（与任务菜单/选择器同款，最稳的底部面板组件） */
const themeActions = computed(() =>
  THEMES.map((t) => ({
    name: t.label + (store.theme === t.id ? "（当前）" : ""),
    value: t.id,
  }))
);

function toggle() {
  show.value = !show.value;
}
function select(id) {
  store.applyTheme(id);
  show.value = false;
  ok(COPY.ok.theme, { duration: 1200 });
}
function onSheetSelect(a) {
  select(a.value);
}
function onDocClick(e) {
  if (show.value && !isMobile.value && !e.target.closest(".theme-wrap")) show.value = false;
}
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="theme-wrap" style="position: relative">
    <button class="icon-btn" title="切换主题" aria-label="切换主题" @click="toggle">🎨</button>

    <!-- 桌面：自绘下拉面板 -->
    <div v-if="show && !isMobile" class="theme-pop-drop" @click.stop>
      <div class="theme-pop-title">主题</div>
      <button
        v-for="t in THEMES"
        :key="t.id"
        class="theme-item"
        :class="{ active: store.theme === t.id }"
        @click="select(t.id)"
      >
        <span
          class="theme-swatch"
          :style="{
            background: `linear-gradient(135deg, ${t.bg} 0%, ${t.bg} 45%, ${t.accent} 46%, ${t.accent} 100%)`,
          }"
        ></span>
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 移动端：van-action-sheet（显式 teleport 到 body，脱离 sticky 顶栏包含块） -->
    <van-action-sheet
      v-if="isMobile"
      v-model:show="show"
      :actions="themeActions"
      title="主题"
      cancel-text="取消"
      close-on-click-action
      teleport="body"
      style="z-index: 4000"
      :style="{ '--van-action-sheet-z-index': 4000, '--van-popup-z-index': 4000 }"
      @select="onSheetSelect"
    />
  </div>
</template>
