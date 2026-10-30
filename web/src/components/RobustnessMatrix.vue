<script setup lang="ts">
// 鲁棒性对比矩阵：行是步骤，列是变更类型，看哪种写法在界面变化后仍然有效
import { computed } from 'vue'
import { MUTATION_LABEL, STEP_TYPE_LABEL, type Mutation, type RunDetail } from '../../../shared/types'
import { STEP_STATUS_LABEL } from '../format'

const props = defineProps<{ runs: RunDetail[] }>()
const order: Mutation[] = ['none', 'attr', 'style']
const cols = computed(() => order.map((m) => props.runs.find((r) => (r.mutation ?? 'none') === m)).filter((r): r is RunDetail => !!r))
const base = computed(() => cols.value[0])

/** 每列：已执行步骤中通过的比例（跳过的不计） */
const rate = (r: RunDetail) => {
  const done = r.steps.filter((s) => s.status === 'passed' || s.status === 'healed' || s.status === 'failed')
  return done.length ? `${Math.round((done.filter((s) => s.status !== 'failed').length / done.length) * 100)}%` : '—'
}
/** 按步骤类型汇总：每种写法在各变更下的存活率 */
const byType = computed(() => {
  const types = [...new Set(base.value?.steps.map((s) => s.type) ?? [])]
  return types.map((t) => ({
    type: t,
    cells: cols.value.map((r) => {
      const steps = r.steps.filter((s) => s.type === t && (s.status === 'passed' || s.status === 'healed' || s.status === 'failed'))
      return steps.length ? `${steps.filter((s) => s.status !== 'failed').length} / ${steps.length}` : '—'
    }),
  }))
})
</script>

<template>
  <div class="card flush" data-test="robustness" v-if="base">
    <table class="table">
      <thead>
        <tr>
          <th style="width: 44px">步骤</th>
          <th>内容</th>
          <th v-for="r in cols" :key="r.id" style="width: 140px">
            <RouterLink :to="`/runs/${r.id}`">{{ MUTATION_LABEL[r.mutation ?? 'none'] }}</RouterLink>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in base.steps" :key="i">
          <td class="num muted">{{ i + 1 }}</td>
          <td>
            <span class="tag" :class="s.type === 'code' ? 'code' : s.type === 'api' ? 'api' : 'ai'">{{ STEP_TYPE_LABEL[s.type] }}</span>
            <span class="content">{{ s.content.split('\n').find((l) => l.trim() && !l.trim().startsWith('//')) }}</span>
          </td>
          <td v-for="r in cols" :key="r.id">
            <span class="tag" :class="r.steps[i]?.status" :title="r.steps[i]?.error ?? ''" data-test="matrix-cell">{{ STEP_STATUS_LABEL[r.steps[i]?.status ?? 'pending'] }}</span>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td></td>
          <td class="muted">步骤通过率（不含跳过）</td>
          <td v-for="r in cols" :key="r.id" class="num"><strong data-test="matrix-rate">{{ rate(r) }}</strong></td>
        </tr>
        <tr v-for="t in byType" :key="t.type">
          <td></td>
          <td class="muted">{{ STEP_TYPE_LABEL[t.type] }} 通过 / 执行</td>
          <td v-for="(c, j) in t.cells" :key="j" class="num">{{ c }}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
.content { margin-left: 8px; font-family: var(--mono); font-size: 12px; }
tfoot td { border-top: 1px solid var(--border); background: #fafbfd; }
</style>
