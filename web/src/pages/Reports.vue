<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import TrendChart, { type Point } from '../components/TrendChart.vue'
import type { RunSummary, Stats, TestCase } from '../../../shared/types'
import { RUN_STATUS_LABEL, formatDuration, formatTime } from '../format'

const router = useRouter()
const days = ref(14)
const caseId = ref<number | ''>('')
const cases = ref<TestCase[]>([])
const stats = ref<Stats | null>(null)
const runs = ref<RunSummary[]>([])

async function load() {
  const id = caseId.value || undefined
  ;[stats.value, runs.value] = await Promise.all([api.stats(days.value, id), api.listRuns(id, 100)])
}
onMounted(async () => {
  cases.value = await api.listCases()
})
watch([days, caseId], load, { immediate: true })

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const finished = computed(() => runs.value.filter((r) => !['queued', 'running'].includes(r.status)))

const rateSeries = computed<Point[]>(() =>
  (stats.value?.daily ?? [])
    .filter((d) => d.passRate !== null)
    .map((d) => ({ label: d.date.slice(5), value: d.passRate!, detail: `${d.passed} / ${d.runs} 次运行通过` })),
)
const durationSeries = computed<Point[]>(() =>
  finished.value
    .slice(0, 30)
    .reverse()
    .map((r) => ({
      label: `#${r.id}`,
      value: r.durationMs,
      detail: `${r.caseName} · ${RUN_STATUS_LABEL[r.status]}`,
      href: `/runs/${r.id}`,
      highlight: r.status === 'failed' || r.status === 'error',
    })),
)
const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}s` : `${Math.round(v)}ms`)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>测试报告</h1>
        <div class="sub">通过率 = 通过运行 / (通过 + 失败 + 异常)；全部步骤被跳过的运行不计入。</div>
      </div>
      <div class="filters">
        <select class="select" v-model="caseId" data-test="filter-case">
          <option value="">全部用例</option>
          <option v-for="c in cases" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <div class="seg">
          <button v-for="d in [7, 14, 30]" :key="d" :class="{ on: days === d }" @click="days = d">近 {{ d }} 天</button>
        </div>
      </div>
    </div>

    <div class="tiles" v-if="stats">
      <div class="tile"><div class="label">运行次数</div><div class="value num" data-test="stat-runs">{{ stats.totalRuns }}</div><div class="foot num">通过 {{ stats.passedRuns }} · 失败 {{ stats.failedRuns }}</div></div>
      <div class="tile"><div class="label">运行通过率</div><div class="value num" data-test="stat-rate">{{ pct(stats.passRate) }}</div><div class="foot">近 {{ days }} 天</div></div>
      <div class="tile"><div class="label">平均耗时</div><div class="value num">{{ formatDuration(stats.avgDurationMs) }}</div><div class="foot">每次运行</div></div>
      <div class="tile"><div class="label">模型调用</div><div class="value num">{{ stats.aiCalls }}</div><div class="foot num">{{ stats.tokens.toLocaleString() }} tokens</div></div>
    </div>

    <div class="charts">
      <div class="card">
        <h2>每日运行通过率</h2>
        <TrendChart v-if="rateSeries.length" :points="rateSeries" kind="line" :max="1" :format="pct" />
        <div v-else class="empty">暂无数据</div>
      </div>
      <div class="card">
        <h2>最近 30 次运行耗时 <span class="muted" style="font-weight: 400; font-size: 12px">（红色为失败，点击柱子查看报告）</span></h2>
        <TrendChart v-if="durationSeries.length" :points="durationSeries" kind="column" :format="fmtMs" @select="(p) => p.href && router.push(p.href)" />
        <div v-else class="empty">暂无数据</div>
      </div>
    </div>

    <div class="card flush">
      <table class="table" data-test="run-table">
        <thead>
          <tr><th style="width: 70px">运行</th><th>用例</th><th style="width: 90px">结果</th><th style="width: 160px">步骤（通过/失败/跳过）</th><th style="width: 100px">耗时</th><th style="width: 130px">模型调用</th><th style="width: 150px">开始时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id" data-test="run-row">
            <td><RouterLink class="num" :to="`/runs/${r.id}`">#{{ r.id }}</RouterLink></td>
            <td>{{ r.caseName }}</td>
            <td><span class="tag" :class="r.status">{{ RUN_STATUS_LABEL[r.status] }}</span></td>
            <td class="num">{{ r.passed }} / <span :style="{ color: r.failed ? 'var(--fail)' : '' }">{{ r.failed }}</span> / {{ r.skipped }}</td>
            <td class="num">{{ formatDuration(r.durationMs) }}</td>
            <td class="num">{{ r.aiCalls ? `${r.aiCalls} 次 · ${r.tokens.toLocaleString()}` : '—' }}</td>
            <td class="num muted" style="white-space: nowrap">{{ formatTime(r.startedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!runs.length" class="empty">还没有运行记录，去用例列表点“运行”吧。</div>
    </div>
  </div>
</template>

<style scoped>
.filters { display: flex; gap: 8px; align-items: center; }
.filters .select { width: 220px; height: 32px; padding: 0 8px; }
.seg { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: #fff; }
.seg button { border: 0; background: none; padding: 0 12px; height: 30px; font-size: 13px; cursor: pointer; color: var(--muted); }
.seg button.on { background: var(--brand-soft); color: var(--brand); }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.tile { background: #fff; border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.tile .label { color: var(--muted); font-size: 12px; }
.tile .value { font-size: 26px; font-weight: 600; margin: 2px 0; }
.tile .foot { color: var(--muted); font-size: 12px; }
.charts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 900px) { .charts, .tiles { grid-template-columns: 1fr 1fr; } .charts { grid-template-columns: 1fr; } }
</style>
