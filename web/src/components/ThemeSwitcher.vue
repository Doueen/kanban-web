<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { showToast } from "vant";
import { THEMES, useAppStore } from "../store";

const store = useAppStore();
const show = ref(false);

const isMobile = computed(() => store.isMobile);

function toggle() {
  show.value = !show.value;
}
function select(id) {
  store.applyTheme(id);
  show.value = false;
  showToast({ message: "主题已切换", duration: 1200 });
}
function onDocClick(e) {
  if (show.value && !e.target.closest(".theme-wrap")) show.value = false;
}
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="theme-wrap" style="position: relative">
    <button class="icon-btn" title="切换主题" aria-label="切换主题" @click="toggle">🎨</button>

    <!-- 桌面：自绘下拉面板（避免 van-popup center transform 定位错位） -->
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
          :style="{ background: `linear-gradient(135deg, ${t.bg} 0%, ${t.bg} 45%, ${t.accent} 46%, ${t.accent} 100%)` }"
        ></span>
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 移动端：底部 sheet -->
    <van-popup
      v-else
      v-model:show="show"
      position="bottom"
      round
      :style="{ width: '100%' }"
    >
      <div class="theme-pop-title" style="padding-top: 16px">主题</div>
      <button
        v-for="t in THEMES"
        :key="t.id"
        class="theme-item"
        :class="{ active: store.theme === t.id }"
        @click="select(t.id)"
      >
        <span
          class="theme-swatch"
          :style="{ background: `linear-gradient(135deg, ${t.bg} 0%, ${t.bg} 45%, ${t.accent} 46%, ${t.accent} 100%)` }"
        ></span>
        <span>{{ t.label }}</span>
      </button>
      <div style="height: calc(8px + env(safe-area-inset-bottom))"></div>
    </van-popup>
  </div>
</template>
