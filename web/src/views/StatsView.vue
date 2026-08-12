<script setup>
import { computed, onMounted, ref } from "vue";
import { showToast } from "vant";
import { useAppStore, STATUS_ORDER, STATUS, STATUS_CSS } from "../store";
import { api } from "../api";
import { dur, fmtTime, ago, kindColor, shortPayload } from "../utils";

const store = useAppStore();
const refreshing = ref(false);
const stats = ref(null);

async function loadStats() {
  try {
    stats.value = await api("/api/stats");
  } catch (err) {
    showToast({ message: "统计加载失败: " + err.message, type: "fail" });
  }
}

async function onRefresh() {
  await Promise.all([store.refreshBoard(), loadStats()]);
  store.eventSince = 0;
  await store.pollEvents();
  refreshing.value = false;
}

const byStatus = computed(() => stats.value?.by_status || {});
const byAssignee = computed(() => stats.value?.by_assignee || {});
const total = computed(() => STATUS_ORDER.reduce((a, s) => a + (byStatus.value[s] || 0), 0) || 1);
const oldest = computed(() => stats.value?.oldest_ready_age_seconds);

/* ---------- 7 天完成趋势（事件流统计） ---------- */
const trendEvents = ref([]);
async function loadTrend() {
  try {
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    trendEvents.value = await api(`/api/events?since=${since}&limit=500`);
  } catch (_) {
    trendEvents.value = [];
  }
}
const trend = computed(() => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: d.toISOString().slice(0, 10), label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 });
  }
  for (const e of trendEvents.value) {
    if (e.kind === "status" && e.payload && e.payload.status === "done") {
      const d = new Date((e.created_at || 0) * 1000);
      const key = d.toISOString().slice(0, 10);
      const hit = days.find((x) => x.key === key);
      if (hit) hit.count++;
    }
  }
  return days;
});
const trendMax = computed(() => Math.max(1, ...trend.value.map((d) => d.count)));
const trendTotal = computed(() => trend.value.reduce((a, d) => a + d.count, 0));

const assigneeRows = computed(() =>
  Object.entries(byAssignee.value)
    .map(([name, counts]) => ({ name, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
);
const maxAssignee = computed(() => assigneeRows.value.reduce((m, r) => Math.max(m, r.total), 1) || 1);

function pct(n) {
  return ((n / total.value) * 100).toFixed(2) + "%";
}

onMounted(() => {
  loadStats();
  loadTrend();
});
</script>

<template>
  <section class="view" aria-label="统计">
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="stats-grid">
        <!-- 7 天完成趋势 -->
        <div class="panel">
          <div class="panel-head"><h3>7 天完成趋势</h3><span class="panel-note num">近 7 天完成 {{ trendTotal }} 个</span></div>
          <div class="trend-chart">
            <div v-for="d in trend" :key="d.key" class="trend-col">
              <span class="trend-val num">{{ d.count || "" }}</span>
              <div class="trend-bar-wrap">
                <div
                  class="trend-bar"
                  :style="{ height: d.count ? Math.max(8, (d.count / trendMax) * 100) + '%' : '3px', opacity: d.count ? 1 : 0.25 }"
                ></div>
              </div>
              <span class="trend-label num">{{ d.label }}</span>
            </div>
          </div>
        </div>

        <!-- 状态分布 -->
        <div class="panel">
          <div class="panel-head"><h3>状态分布</h3><span class="panel-note num">共 {{ total }} 个</span></div>
          <div v-for="st in STATUS_ORDER" :key="st" class="bar-row">
            <span class="bar-label"><span class="dot" :style="{ background: STATUS_CSS[st] }"></span>{{ STATUS[st] }}</span>
            <div class="bar-track">
              <div class="bar-seg" :style="{ width: pct(byStatus[st] || 0), background: STATUS_CSS[st] }"></div>
            </div>
            <span class="bar-val num">{{ byStatus[st] || 0 }}</span>
          </div>
        </div>

        <!-- 指派分布 -->
        <div class="panel">
          <div class="panel-head"><h3>指派分布</h3><span class="panel-note">{{ assigneeRows.length }} 人</span></div>
          <van-empty v-if="!assigneeRows.length" description="暂无指派" />
          <div v-for="r in assigneeRows" :key="r.name" class="bar-row">
            <span class="bar-label">@{{ r.name }}</span>
            <div class="bar-track">
              <div class="bar-seg" :style="{ width: ((r.total / maxAssignee) * 100).toFixed(1) + '%', background: 'var(--accent)' }"></div>
            </div>
            <span class="bar-val num">{{ r.total }}</span>
          </div>
        </div>

        <!-- 最老 Ready -->
        <div class="panel">
          <div class="panel-head"><h3>最老 Ready 任务</h3></div>
          <div class="big-number num">{{ oldest !== null && oldest !== undefined ? dur(oldest) : "—" }}</div>
          <div class="big-label">等待就绪最久的任务</div>
          <div class="big-sub">{{ stats && stats.now ? "统计时间 " + fmtTime(stats.now) : "" }}</div>
        </div>

        <!-- 事件流 -->
        <div class="panel">
          <div class="panel-head"><h3>全局事件流</h3><span class="panel-note">5 秒增量</span></div>
          <div class="events-list">
            <div v-if="store.events.length">
              <div
                v-for="e in store.events"
                :key="e.id"
                class="event"
                :style="{ '--evc': kindColor(e.kind) }"
              >
                <span class="event-kind">{{ e.kind }}</span>
                <span class="event-body">{{ shortPayload(e.payload) }}</span>
                <span class="event-time num">{{ ago(e.created_at) }}</span>
              </div>
            </div>
            <div v-else class="empty" style="padding: 20px">等待事件…</div>
          </div>
        </div>
      </div>
    </van-pull-refresh>
  </section>
</template>
