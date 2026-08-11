<script setup>
import { computed, ref } from "vue";
import { showToast } from "vant";
import { THEMES, useAppStore } from "../store";

const store = useAppStore();
const show = ref(false);

const isMobile = computed(() => store.isMobile);

function select(id) {
  store.applyTheme(id);
  show.value = false;
  showToast({ message: "主题已切换", duration: 1200 });
}
</script>

<template>
  <div class="theme-wrap" style="position: relative">
    <button class="icon-btn" title="切换主题" aria-label="切换主题" @click="show = !show">🎨</button>

    <van-popup
      v-model:show="show"
      :position="isMobile ? 'bottom' : 'center'"
      :round="isMobile"
      :style="{ width: isMobile ? '100%' : '220px' }"
      class="theme-pop"
    >
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
    </van-popup>
  </div>
</template>
