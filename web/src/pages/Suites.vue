<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import type { BatchSummary, Suite } from '../../../shared/types'
import { RUN_STATUS_LABEL, formatDuration, formatTime } from '../format'

const router = useRouter()
const suites = ref<Suite[]>([])
const batches = ref<BatchSummary[]>([])
const error = ref('')

async function load() {
  ;[suites.value, batches.value] = await Promise.all([api.listSuites(), api.listBatches()])
}
async function run(s: Suite) {
  try {
    const { batchId } = await api.runSuite(s.id)
    router.push(`/batches/${batchId}`)
  } catch (e: any) {
    error.value = e.message
  }
}
async function remove(s: Suite) {
  if (!confirm(`确定删除用例集“${s.name}”？（不会删除其中的用例和历史运行）`)) return
  await api.deleteSuite(s.id)
  await load()
}
onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>用例集</h1>
        <div class="sub">把多个用例组成用例集一键批量运行；CI 中用 <code>npm run ci:run -- --suite 名称</code> 触发，并导出 JUnit 报告。</div>
      </div>
      <RouterLink class="btn primary" to="/suites/new" data-test="new-suite">+ 新建用例集</RouterLink>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div class="card flush">
      <table class="table" data-test="suite-table">
        <thead>
          <tr><th style="width: 56px">ID</th><th>名称</th><th style="width: 90px">用例数</th><th style="width: 220px">最近一次</th><th style="width: 220px"></th></tr>
        </thead>
        <tbody>
          <tr v-for="s in suites" :key="s.id" data-test="suite-row">
            <td class="num muted">#{{ s.id }}</td>
            <td>
              <div>{{ s.name }}</div>
              <div class="muted" style="font-size: 12px" v-if="s.description">{{ s.description }}</div>
            </td>
            <td class="num">{{ s.caseIds.length }}</td>
            <td>
              <template v-if="s.lastBatch">
                <RouterLink :to="`/batches/${s.lastBatch.id}`"><span class="tag" :class="s.lastBatch.status">{{ RUN_STATUS_LABEL[s.lastBatch.status] }}</span></RouterLink>
                <span class="num muted" style="font-size: 12px; margin-left: 6px">{{ s.lastBatch.passed }}/{{ s.lastBatch.total }} · {{ formatTime(s.lastBatch.createdAt) }}</span>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <div class="actions">
                <button class="btn sm primary" @click="run(s)" data-test="run-suite">▶ 运行</button>
                <RouterLink class="btn sm" :to="`/suites/${s.id}/edit`">编辑</RouterLink>
                <button class="btn sm danger" @click="remove(s)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!suites.length" class="empty">还没有用例集。</div>
    </div>

    <h2 style="font-size: 15px; margin: 24px 0 10px">最近的批量运行</h2>
    <div class="card flush">
      <table class="table" data-test="batch-table">
        <thead>
          <tr><th style="width: 70px">批次</th><th>名称</th><th style="width: 70px">触发</th><th style="width: 90px">结果</th><th style="width: 150px">通过 / 失败 / 跳过</th><th style="width: 100px">耗时</th><th style="width: 150px">时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in batches" :key="b.id" data-test="batch-row">
            <td><RouterLink class="num" :to="`/batches/${b.id}`">#{{ b.id }}</RouterLink></td>
            <td>{{ b.name }}</td>
            <td><span class="tag">{{ b.trigger === 'ci' ? 'CI' : '手动' }}</span></td>
            <td><span class="tag" :class="b.status">{{ RUN_STATUS_LABEL[b.status] }}</span></td>
            <td class="num">{{ b.passed }} / {{ b.failed }} / {{ b.skipped }}</td>
            <td class="num">{{ b.durationMs ? formatDuration(b.durationMs) : '—' }}</td>
            <td class="num muted" style="white-space: nowrap">{{ formatTime(b.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!batches.length" class="empty">暂无批量运行。</div>
    </div>
  </div>
</template>
