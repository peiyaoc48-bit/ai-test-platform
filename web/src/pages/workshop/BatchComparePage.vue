<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api'
import { batchName, pct, propParts } from './fmt'
import { DISCARD_REASON_LABEL, type BatchCompare, type DiscardReason, type GenBatch } from '../../../../shared/types'

const route = useRoute()
const cmp = ref<BatchCompare | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    cmp.value = await api.compareBatches(Number(route.query.a), Number(route.query.b))
  } catch (e: any) {
    error.value = e.message
  }
})

const rows = computed(() => {
  if (!cmp.value) return []
  const m = (f: (b: GenBatch) => string) => [f(cmp.value!.a), f(cmp.value!.b)]
  const prop = (k: 'adoption' | 'direct' | 'firstRun') => (b: GenBatch) => {
    const p = propParts(b.stats[k])
    return b.stats[k].n ? `${p.rate}（${p.frac}${p.ci ? `，CI ${p.ci}` : ''}）` : '—'
  }
  return [
    { k: 'Prompt / 模型', v: m((b) => `gen-${b.promptVersion} · ${b.model}`) },
    { k: '需求点范围', v: m((b) => `${b.scope.length} 个`) },
    { k: '草稿数 / 已审核', v: m((b) => `${b.stats.total} / ${b.stats.reviewed}`) },
    { k: '采纳率', v: m(prop('adoption')), strong: true },
    { k: '直接采纳率', v: m(prop('direct')) },
    { k: '平均修改步数', v: m((b) => (b.stats.avgEditedSteps === null ? '—' : b.stats.avgEditedSteps.toFixed(1))) },
    { k: '生成即跑通率', v: m(prop('firstRun')) },
    { k: '新增关联需求点', v: m((b) => `+${b.stats.newlyLinked}`) },
    { k: 'Token / 每条采纳用例', v: m((b) => `${b.tokens.toLocaleString()} / ${b.stats.tokensPerAdopted?.toLocaleString() ?? '—'}`) },
    ...(Object.keys(DISCARD_REASON_LABEL) as DiscardReason[]).map((r) => ({
      k: `废弃：${DISCARD_REASON_LABEL[r]}`,
      v: m((b) => (b.stats.reviewed ? `${b.stats.reasons[r]}（${pct(b.stats.reasons[r] / b.stats.reviewed, 0)}）` : '—')),
    })),
  ]
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>批次对比</h1>
        <div class="sub">比较两版 Prompt（或两个模型）在同一需求上的生成质量。采纳率差异用 Fisher 精确检验；样本少时置信区间很宽，结论仅供参考。</div>
      </div>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <template v-if="cmp">
      <div v-if="!cmp.sameScope" class="alert warn"><AlertTriangle :size="16" /><div>两批针对的需求点不同，输入不可比，以下差异不能归因于 Prompt。</div></div>
      <div v-if="!cmp.enoughSamples" class="alert warn"><AlertTriangle :size="16" /><div>样本量不足（每批已审核少于 20 条），结论仅供参考。</div></div>

      <div class="card flush">
        <table class="table cmp" data-test="compare-table">
          <thead>
            <tr>
              <th style="width: 200px">指标</th>
              <th><RouterLink :to="`/workshop/batches/${cmp.a.id}`">{{ batchName(cmp.a.seq) }}</RouterLink></th>
              <th><RouterLink :to="`/workshop/batches/${cmp.b.id}`">{{ batchName(cmp.b.seq) }}</RouterLink></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.k" :class="{ strong: r.strong }">
              <td class="muted">{{ r.k }}</td>
              <td class="num">{{ r.v[0] }}</td>
              <td class="num">{{ r.v[1] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="card verdict">
        <div class="muted" style="font-size: 12px">采纳率差异（Fisher 精确检验，双侧）</div>
        <div class="num p">p = {{ cmp.adoptionPValue === null ? '—' : cmp.adoptionPValue < 0.001 ? '< 0.001' : cmp.adoptionPValue.toFixed(3) }}</div>
        <div class="muted" style="font-size: 13px">
          <template v-if="cmp.adoptionPValue === null">至少一批还没有审核结果。</template>
          <template v-else-if="cmp.adoptionPValue < 0.05">差异在 0.05 水平上显著。</template>
          <template v-else>差异不显著：现有样本不足以说明两批采纳率不同。</template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cmp tr.strong td { font-weight: 600; background: #fafbff; }
.verdict { margin-top: 16px; }
.verdict .p { font-size: 22px; font-weight: 600; margin: 4px 0; }
</style>
