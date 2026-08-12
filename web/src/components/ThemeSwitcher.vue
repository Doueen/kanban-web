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
          :style="{ background: `linear-gradient(135deg, ${t.bg} 0%, ${t.bg} 45%, ${t.accent} 46%, ${t.accent} 100%)` }"
        ></span>
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 移动端：自绘底部 sheet（避免 van-popup teleport/z-index 遮挡问题） -->
    <template v-if="show && isMobile">
      <div class="theme-sheet-mask" @click="show = false"></div>
      <div class="theme-sheet" role="dialog" aria-label="主题" @click.stop>
        <div class="theme-sheet-handle"></div>
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
        <div style="height: calc(10px + env(safe-area-inset-bottom))"></div>
      </div>
    </template>
  </div>
</template>
