<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../api'
import type { BatchDetail } from '../../../shared/types'
import { RUN_STATUS_LABEL, formatDuration, formatTime } from '../format'

const props = defineProps<{ id: string }>()
const batch = ref<BatchDetail | null>(null)
const error = ref('')
let timer: number | undefined

const done = computed(() => (batch.value ? batch.value.passed + batch.value.failed + batch.value.skipped : 0))

async function load() {
  try {
    batch.value = await api.getBatch(Number(props.id))
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
          <span class="tag" :class="batch.status" data-test="batch-status" style="margin-left: 8px; vertical-align: 3px">{{ RUN_STATUS_LABEL[batch.status] }}</span>
        </h1>
        <div class="sub num">{{ batch.trigger === 'ci' ? 'CI 触发' : '手动触发' }} · {{ formatTime(batch.createdAt) }}</div>
      </div>
      <a class="btn" :href="`/api/batches/${batch.id}/junit`" data-test="junit">下载 JUnit 报告</a>
    </div>

    <div class="progress"><div class="bar" :style="{ width: `${batch.total ? (done / batch.total) * 100 : 0}%` }"></div></div>
    <div class="sub num" style="margin: 6px 0 14px">
      已完成 {{ done }} / {{ batch.total }} · 通过 {{ batch.passed }} · 失败 {{ batch.failed }} · 跳过 {{ batch.skipped }}
      <template v-if="batch.durationMs"> · 耗时 {{ formatDuration(batch.durationMs) }}</template>
    </div>

    <div class="card flush">
      <table class="table">
        <thead><tr><th style="width: 70px">运行</th><th>用例</th><th style="width: 90px">结果</th><th style="width: 160px">步骤（通过/失败/跳过）</th><th style="width: 100px">耗时</th></tr></thead>
        <tbody>
          <tr v-for="r in batch.runs" :key="r.id" data-test="batch-run">
            <td><RouterLink class="num" :to="`/runs/${r.id}`">#{{ r.id }}</RouterLink></td>
            <td>{{ r.caseName }}</td>
            <td><span class="tag" :class="r.status">{{ RUN_STATUS_LABEL[r.status] }}</span></td>
            <td class="num">{{ r.passed }} / {{ r.failed }} / {{ r.skipped }}</td>
            <td class="num">{{ r.durationMs ? formatDuration(r.durationMs) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="page" v-else-if="error"><div class="alert error">{{ error }}</div></div>
</template>

<style scoped>
.progress { height: 6px; background: #e6eaf2; border-radius: 3px; overflow: hidden; }
.bar { height: 100%; background: var(--brand); transition: width .3s; }
</style>
