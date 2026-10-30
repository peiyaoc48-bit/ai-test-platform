<script setup lang="ts">
import { canEdit } from '../session'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Activity, AlertTriangle, CheckCircle2, Clock, FileText, Plus, Sparkles, TrendingDown, TrendingUp, Zap } from 'lucide-vue-next'
import { api } from '../api'
import TrendChart, { type Point } from '../components/TrendChart.vue'
import StatusBadge from '../ui/StatusBadge.vue'
import RunDots from '../ui/RunDots.vue'
import type { DashboardData } from '../../../shared/types'
import { formatDuration, formatTime } from '../format'

const router = useRouter()
const d = ref<DashboardData | null>(null)
onMounted(async () => (d.value = await api.dashboard()))

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const delta = computed(() => {
  if (!d.value || d.value.week.passRate === null || d.value.prevPassRate === null) return null
  return Math.round((d.value.week.passRate - d.value.prevPassRate) * 100)
})
const totalSteps = computed(() => (d.value ? d.value.counts.codeSteps + d.value.counts.aiSteps + d.value.counts.apiSteps : 0))
const share = (n: number) => (totalSteps.value ? `${(n / totalSteps.value) * 100}%` : '0%')
const trend = computed<Point[]>(() =>
  (d.value?.daily ?? []).filter((x) => x.passRate !== null).map((x) => ({ label: x.date.slice(5), value: x.passRate!, detail: `${x.passed} / ${x.runs} 次运行通过` })),
)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>概览</h1>
        <div class="sub">近 7 天的执行情况、需要关注的失败与不稳定用例。变更注入（鲁棒性对比）的运行不计入统计。</div>
      </div>
      <div class="head-actions" v-if="canEdit">
        <RouterLink class="btn" to="/generate"><Sparkles :size="15" />AI 生成用例</RouterLink>
        <RouterLink class="btn primary" to="/cases/new"><Plus :size="15" />新建用例</RouterLink>
      </div>
    </div>

    <template v-if="d">
      <div class="kpis">
        <div class="kpi">
          <div class="label"><FileText :size="14" />用例</div>
          <div class="value num" data-test="kpi-cases">{{ d.counts.cases }}</div>
          <div class="compose" :title="`代码 ${d.counts.codeSteps} · AI ${d.counts.aiSteps} · 接口 ${d.counts.apiSteps}`">
            <span class="seg code" :style="{ width: share(d.counts.codeSteps) }"></span>
            <span class="seg ai" :style="{ width: share(d.counts.aiSteps) }"></span>
            <span class="seg api" :style="{ width: share(d.counts.apiSteps) }"></span>
          </div>
          <div class="foot legend">
            <span><i class="code"></i>代码 {{ d.counts.codeSteps }}</span>
            <span><i class="ai"></i>AI {{ d.counts.aiSteps }}</span>
            <span><i class="api"></i>接口 {{ d.counts.apiSteps }}</span>
          </div>
        </div>
        <div class="kpi">
          <div class="label"><Activity :size="14" />近 7 天运行</div>
          <div class="value num">{{ d.week.totalRuns }}</div>
          <div class="foot num">通过 {{ d.week.passedRuns }} · 失败 {{ d.week.failedRuns }}</div>
        </div>
        <div class="kpi">
          <div class="label"><CheckCircle2 :size="14" />运行通过率</div>
          <div class="value num" data-test="kpi-rate">{{ pct(d.week.passRate) }}</div>
          <div class="foot">
            <template v-if="delta !== null">
              <span class="delta" :class="delta >= 0 ? 'up' : 'down'">
                <TrendingUp v-if="delta >= 0" :size="13" /><TrendingDown v-else :size="13" />
                {{ delta >= 0 ? '+' : '' }}{{ delta }} 个百分点
              </span>
              较上周
            </template>
            <template v-else>上周无数据</template>
          </div>
        </div>
        <div class="kpi">
          <div class="label"><Clock :size="14" />平均耗时</div>
          <div class="value num">{{ formatDuration(d.week.avgDurationMs) }}</div>
          <div class="foot num"><Zap :size="12" style="vertical-align: -1px" /> 模型 {{ d.week.aiCalls }} 次 · {{ d.week.tokens.toLocaleString() }} tokens</div>
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <h2>每日运行通过率 <span class="muted" style="font-weight: 400; font-size: 12px">近 14 天</span></h2>
          <TrendChart v-if="trend.length" :points="trend" kind="line" :max="1" :format="pct" :height="190" />
          <div v-else class="empty">还没有运行数据</div>
        </div>
        <div class="card flush">
          <div class="card-head">
            <h2><AlertTriangle :size="15" style="color: var(--fail)" />最近失败</h2>
            <RouterLink to="/reports" class="muted" style="font-size: 12px">全部运行 →</RouterLink>
          </div>
          <div v-if="d.failing.length" class="list">
            <RouterLink v-for="r in d.failing" :key="r.id" :to="`/runs/${r.id}`" class="list-item" data-test="failing-item">
              <StatusBadge :status="r.status" size="sm" />
              <span class="name">{{ r.caseName }}</span>
              <span class="muted num">{{ formatTime(r.startedAt) }}</span>
            </RouterLink>
          </div>
          <div v-else class="empty"><CheckCircle2 :size="28" /><div>各用例最近一次运行都没有失败</div></div>
        </div>
      </div>

      <div class="grid2">
        <div class="card flush">
          <div class="card-head">
            <h2>不稳定用例</h2>
            <span class="muted" style="font-size: 12px">最近 {{ d.flakyRule.window }} 次中通过 / 失败切换 ≥ {{ d.flakyRule.minTransitions }} 次</span>
          </div>
          <table v-if="d.flaky.length" class="table" data-test="flaky-table">
            <tbody>
              <tr v-for="f in d.flaky" :key="f.caseId">
                <td><RouterLink :to="`/cases/${f.caseId}/edit`" class="row-title">{{ f.caseName }}</RouterLink></td>
                <td style="width: 120px"><RunDots :statuses="f.recent" /></td>
                <td style="width: 90px" class="num muted">切换 {{ f.transitions }}</td>
                <td style="width: 70px" class="num">{{ pct(f.passRate) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty"><div>暂无不稳定用例</div></div>
        </div>
        <div class="card flush">
          <div class="card-head"><h2>最近运行</h2></div>
          <table class="table">
            <tbody>
              <tr v-for="r in d.recent" :key="r.id" style="cursor: pointer" @click="router.push(`/runs/${r.id}`)">
                <td style="width: 64px" class="num muted">#{{ r.id }}</td>
                <td>
                  <div class="row-title">{{ r.caseName }}</div>
                  <div class="row-sub">{{ r.envName ?? '默认环境' }}<template v-if="r.mutation && r.mutation !== 'none'"> · 变更注入</template></div>
                </td>
                <td style="width: 90px"><StatusBadge :status="r.status" size="sm" /></td>
                <td style="width: 80px" class="num muted">{{ formatDuration(r.durationMs) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="kpis"><div v-for="i in 4" :key="i" class="kpi"><div class="skeleton" style="width: 40%"></div><div class="skeleton" style="height: 28px; margin: 10px 0; width: 60%"></div></div></div>
    </template>
  </div>
</template>

<style scoped>
.grid2 { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; }
.grid2 > .card { margin-bottom: 16px; }
.compose { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: #eef1f6; margin: 6px 0 6px; gap: 2px; }
.seg.code, .legend i.code { background: #64748b; }
.seg.ai, .legend i.ai { background: #7c5cdb; }
.seg.api, .legend i.api { background: #0e8a9a; }
.legend { display: flex; gap: 10px; }
.legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 4px; vertical-align: 0; }
.list { display: flex; flex-direction: column; }
.list-item { display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid #eef1f5; color: var(--text); }
.list-item:last-child { border-bottom: 0; }
.list-item:hover { background: #f8faff; text-decoration: none; }
.list-item .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-item .num { font-size: 12px; }
@media (max-width: 960px) { .grid2 { grid-template-columns: 1fr; } }
</style>
