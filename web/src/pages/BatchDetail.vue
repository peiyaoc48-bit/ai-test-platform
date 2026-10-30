<script setup lang="ts">
import { AlertCircle, Download, ShieldCheck } from 'lucide-vue-next'
import StatusBadge from '../ui/StatusBadge.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../api'
import type { BatchDetail, RunDetail } from '../../../shared/types'
import RobustnessMatrix from '../components/RobustnessMatrix.vue'
import { RUN_STATUS_LABEL, formatDuration, formatTime } from '../format'

const props = defineProps<{ id: string }>()
const batch = ref<BatchDetail | null>(null)
const details = ref<RunDetail[]>([])
const error = ref('')
let timer: number | undefined

const done = computed(() => (batch.value ? batch.value.passed + batch.value.failed + batch.value.skipped : 0))

async function load() {
  try {
    batch.value = await api.getBatch(Number(props.id))
    if (batch.value.kind === 'robustness') details.value = await Promise.all(batch.value.runs.map((r) => api.getRun(r.id)))
  } catch (e: any) {
    error.value = e.message
  }
  clearTimeout(timer)
  if (batch.value?.status === 'running') timer = window.setTimeout(load, 1000)
}
watch(() => props.id, load, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="page" v-if="batch">
    <div class="page-head">
      <div>
        <h1>
          批次 <span class="num">#{{ batch.id }}</span> · {{ batch.name }}
          <span data-test="batch-status"><StatusBadge :status="batch.status" /></span>
        </h1>
        <div class="sub num">{{ batch.trigger === 'ci' ? 'CI 触发' : '手动触发' }} · {{ formatTime(batch.createdAt) }}</div>
      </div>
      <a class="btn" :href="`/api/batches/${batch.id}/junit`" data-test="junit"><Download :size="14" />下载 JUnit 报告</a>
    </div>

    <div class="progress"><div class="bar" :style="{ width: `${batch.total ? (done / batch.total) * 100 : 0}%` }"></div></div>
    <div class="sub num" style="margin: 6px 0 14px">
      已完成 {{ done }} / {{ batch.total }} · 通过 {{ batch.passed }} · 失败 {{ batch.failed }} · 跳过 {{ batch.skipped }}
      <template v-if="batch.durationMs"> · 耗时 {{ formatDuration(batch.durationMs) }}</template>
    </div>

    <template v-if="batch.kind === 'robustness'">
      <div class="alert info"><ShieldCheck :size="16" />
        同一用例分别在三种情况下运行（失败后继续执行）：无变更、去掉 data-test 等测试标记、更换视觉样式。依赖测试标记的选择器在第二列会失效，视觉断言不受影响；需要配置模型才能看到视觉步骤的结果。
      </div>
      <RobustnessMatrix :runs="details" />
    </template>
    <div class="card flush" v-else>
      <table class="table">
        <thead><tr><th style="width: 70px">运行</th><th>用例</th><th style="width: 90px">结果</th><th style="width: 160px">步骤（通过/失败/跳过）</th><th style="width: 100px">耗时</th></tr></thead>
        <tbody>
          <tr v-for="r in batch.runs" :key="r.id" data-test="batch-run">
            <td><RouterLink class="num" :to="`/runs/${r.id}`">#{{ r.id }}</RouterLink></td>
            <td>{{ r.caseName }}</td>
            <td><StatusBadge :status="r.status" size="sm" /></td>
            <td class="num">{{ r.passed }} / {{ r.failed }} / {{ r.skipped }}</td>
            <td class="num">{{ r.durationMs ? formatDuration(r.durationMs) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="page" v-else-if="error"><div class="alert error"><AlertCircle :size="16" />{{ error }}</div></div>
</template>

<style scoped>
.progress { height: 6px; background: #e6eaf2; border-radius: 3px; overflow: hidden; }
.bar { height: 100%; background: var(--brand); transition: width .3s; }
</style>
