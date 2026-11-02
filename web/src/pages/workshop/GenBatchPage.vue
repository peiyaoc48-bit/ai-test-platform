<script setup lang="ts">
import { ClipboardCheck, Play } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { canEdit } from '../../session'
import { formatDuration, formatTime } from '../../format'
import { batchName, pct, propParts } from './fmt'
import { DISCARD_REASON_LABEL, VERDICT_LABEL, type DiscardReason, type GenBatchDetail } from '../../../../shared/types'

const props = defineProps<{ id: string }>()
const router = useRouter()
const batch = ref<GenBatchDetail | null>(null)
const error = ref('')

onMounted(async () => (batch.value = await api.getGenBatch(Number(props.id))))

const codeOf = computed(() => new Map(batch.value?.points.map((p) => [p.id, p.code]) ?? []))
const reasons = computed(() => {
  const s = batch.value!.stats
  return (Object.entries(s.reasons) as [DiscardReason, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
})
const VERDICT_TAG = { pending: 'queued', accepted: 'passed', edited: 'healed', discarded: 'failed' } as const

async function runAdopted() {
  error.value = ''
  try {
    const { batchId } = await api.runGenBatch(batch.value!.id)
    router.push(`/batches/${batchId}`)
  } catch (e: any) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="page wide" v-if="batch">
    <div class="page-head">
      <div>
        <h1>{{ batchName(batch.seq) }} <span class="tag ai" style="vertical-align: middle">gen-{{ batch.promptVersion }}</span></h1>
        <div class="meta">
          <span>需求 <RouterLink :to="`/workshop/requirements/${batch.requirementId}?tab=batches`">#{{ batch.requirementId }}</RouterLink></span>
          <span>模型 <b>{{ batch.model }}</b></span>
          <span>范围 <b>{{ batch.scope.length }}</b> 个需求点</span>
          <span>Token <b>{{ batch.tokens.toLocaleString() }}</b> · 耗时 <b>{{ formatDuration(batch.durationMs) }}</b></span>
          <span>{{ formatTime(batch.createdAt) }}</span>
          <span class="muted" :title="batch.inputHash">输入指纹 <code>{{ batch.inputHash.slice(0, 10) }}</code></span>
        </div>
      </div>
      <div class="head-actions">
        <button v-if="canEdit && batch.drafts.some((d) => d.caseId)" class="btn" @click="runAdopted" data-test="run-adopted"><Play :size="14" />运行本批入库用例</button>
        <RouterLink v-if="canEdit && batch.stats.reviewed < batch.stats.total" class="btn primary" :to="`/workshop/batches/${batch.id}/review`">
          <ClipboardCheck :size="14" />继续审核（剩 {{ batch.stats.total - batch.stats.reviewed }}）
        </RouterLink>
      </div>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="card flush summary">
      <div title="(通过 + 修改后通过) / 已审核">
        <div class="k">采纳率</div>
        <div class="v num">{{ propParts(batch.stats.adoption).rate }}</div>
        <div class="f num">{{ propParts(batch.stats.adoption).frac }}<template v-if="batch.stats.adoption.ci"> · 95% CI {{ propParts(batch.stats.adoption).ci }}</template></div>
      </div>
      <div title="原样通过 / 已审核">
        <div class="k">直接采纳率</div>
        <div class="v num">{{ propParts(batch.stats.direct).rate }}</div>
        <div class="f num">{{ batch.stats.accepted }} 条原样通过</div>
      </div>
      <div title="修改后通过的草稿，平均改动的步数（增 + 删 + 改）">
        <div class="k">平均修改步数</div>
        <div class="v num">{{ batch.stats.avgEditedSteps === null ? '—' : batch.stats.avgEditedSteps.toFixed(1) }}</div>
        <div class="f num">{{ batch.stats.edited }} 条修改后通过</div>
      </div>
      <div title="本批入库用例第一次运行（无变更注入、排除跳过）的通过率">
        <div class="k">生成即跑通率</div>
        <div class="v num">{{ propParts(batch.stats.firstRun).rate }}</div>
        <div class="f num">{{ batch.stats.firstRun.n ? `${propParts(batch.stats.firstRun).frac} 条首次运行通过` : '入库后运行一次即可统计' }}</div>
      </div>
      <div title="本批让多少个需求点从“未关联”变为“已关联”">
        <div class="k">新增关联需求点</div>
        <div class="v num">+{{ batch.stats.newlyLinked }}</div>
        <div class="f num">每条采纳用例 {{ batch.stats.tokensPerAdopted?.toLocaleString() ?? '—' }} token</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 12px">审核结果</h2>
        <div class="stack" v-if="batch.stats.total">
          <i class="passed" :style="{ width: pct(batch.stats.accepted / batch.stats.total) }" :title="`通过 ${batch.stats.accepted}`"></i>
          <i class="healed" :style="{ width: pct(batch.stats.edited / batch.stats.total) }" :title="`修改后通过 ${batch.stats.edited}`"></i>
          <i class="failed" :style="{ width: pct(batch.stats.discarded / batch.stats.total) }" :title="`废弃 ${batch.stats.discarded}`"></i>
        </div>
        <div class="legend">
          <span><i class="passed"></i>通过 {{ batch.stats.accepted }}</span>
          <span><i class="healed"></i>修改后通过 {{ batch.stats.edited }}</span>
          <span><i class="failed"></i>废弃 {{ batch.stats.discarded }}</span>
          <span><i></i>待审核 {{ batch.stats.total - batch.stats.reviewed }}</span>
        </div>
      </div>
      <div class="card">
        <h2 style="margin: 0 0 12px">废弃原因</h2>
        <div v-for="[r, n] in reasons" :key="r" class="reason">
          <span class="rl">{{ DISCARD_REASON_LABEL[r] }}</span>
          <div class="rb"><i :style="{ width: pct(n / batch.stats.discarded) }"></i></div>
          <span class="num">{{ n }}</span>
        </div>
        <div v-if="!reasons.length" class="muted" style="font-size: 13px">暂无废弃。废弃原因是改进下一版 Prompt 的依据。</div>
      </div>
    </div>

    <div class="card flush">
      <div class="card-head"><h2>草稿（{{ batch.drafts.length }}）</h2></div>
      <table class="table" data-test="draft-table">
        <thead>
          <tr><th style="width: 56px">#</th><th>用例</th><th style="width: 170px">需求点</th><th style="width: 70px">置信度</th><th style="width: 110px">判定</th><th style="width: 190px">修改 / 原因</th><th style="width: 90px">入库用例</th></tr>
        </thead>
        <tbody>
          <tr v-for="(d, i) in batch.drafts" :key="d.id" data-test="draft-row">
            <td class="num muted">{{ i + 1 }}</td>
            <td>
              <div>{{ d.final?.name ?? d.name }}</div>
              <div class="muted" style="font-size: 12px">{{ d.steps.length }} 步<template v-if="d.final && d.final.name !== d.name"> · 原名：{{ d.name }}</template></div>
            </td>
            <td><span v-for="p in d.final?.pointIds ?? d.pointIds" :key="p" class="tag" style="margin: 0 4px 2px 0">{{ codeOf.get(p) }}</span></td>
            <td class="num">{{ d.confidence === null ? '—' : d.confidence.toFixed(2) }}</td>
            <td><span class="tag" :class="VERDICT_TAG[d.verdict]">{{ VERDICT_LABEL[d.verdict] }}</span></td>
            <td style="font-size: 12.5px">
              <template v-if="d.editStats">改 {{ d.editStats.changed }} · 增 {{ d.editStats.added }} · 删 {{ d.editStats.removed }}<template v-if="d.editStats.nameChanged"> · 改名</template></template>
              <template v-else-if="d.discardReason">{{ DISCARD_REASON_LABEL[d.discardReason] }}</template>
              <div v-if="d.note" class="muted">{{ d.note }}</div>
            </td>
            <td><RouterLink v-if="d.caseId" :to="`/cases/${d.caseId}/edit`" class="num">#{{ d.caseId }}</RouterLink><span v-else class="muted">—</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page.wide { max-width: 1440px; }
.meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); font-size: 12.5px; margin-top: 6px; }
.meta b { color: var(--text-2); font-weight: 500; }
.summary { display: grid; grid-template-columns: repeat(5, 1fr); padding: 0; margin-bottom: 16px; }
.summary > div { padding: 14px 18px; border-right: 1px solid var(--border); cursor: help; }
.summary > div:last-child { border-right: 0; }
.summary .k { color: var(--muted); font-size: 12px; }
.summary .v { font-size: 22px; font-weight: 600; margin: 2px 0; }
.summary .f { color: var(--muted); font-size: 12px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.stack { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #eef1f6; }
.stack i, .legend i { display: block; background: #d7dde8; }
.stack .passed, .legend .passed { background: var(--pass); }
.stack .healed, .legend .healed { background: #4f8be0; }
.stack .failed, .legend .failed { background: #e8907f; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; margin-top: 10px; color: var(--text-2); }
.legend span { display: flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; }
.reason { display: grid; grid-template-columns: 110px 1fr 30px; gap: 10px; align-items: center; font-size: 12.5px; margin-bottom: 6px; }
.rb { height: 8px; background: #eef1f6; border-radius: 4px; overflow: hidden; }
.rb i { display: block; height: 100%; background: #e8907f; }
@media (max-width: 1000px) { .summary { grid-template-columns: repeat(2, 1fr); } .grid { grid-template-columns: 1fr; } }
</style>
