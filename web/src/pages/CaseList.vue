<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import type { TestCase } from '../../../shared/types'
import { RUN_STATUS_LABEL, formatTime } from '../format'

const router = useRouter()
const cases = ref<TestCase[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  try {
    cases.value = await api.listCases()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function remove(c: TestCase) {
  if (!confirm(`确定删除用例“${c.name}”？其运行记录也会一并删除。`)) return
  await api.deleteCase(c.id)
  await load()
}

async function run(c: TestCase) {
  const { runId } = await api.runCase(c.id)
  router.push(`/runs/${runId}`)
}

const aiCount = (c: TestCase) => c.steps.filter((s) => s.type !== 'code').length

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>用例管理</h1>
        <div class="sub">一个用例 = 目标 URL + 步骤列表；步骤可以是自然语言（交给 Midscene 视觉模型）或 Playwright 代码。</div>
      </div>
      <RouterLink class="btn primary" to="/cases/new" data-test="new-case">+ 新建用例</RouterLink>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div class="card flush">
      <table class="table" data-test="case-table">
        <thead>
          <tr>
            <th style="width: 56px">ID</th>
            <th>用例名称</th>
            <th>目标 URL</th>
            <th style="width: 150px">步骤</th>
            <th style="width: 170px">最近运行</th>
            <th style="width: 220px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cases" :key="c.id" data-test="case-row">
            <td class="num muted">#{{ c.id }}</td>
            <td>
              <div data-test="case-name">{{ c.name }}</div>
              <div class="muted" style="font-size: 12px" v-if="c.description">{{ c.description }}</div>
            </td>
            <td class="num" style="font-size: 12px; word-break: break-all">{{ c.url }}</td>
            <td>
              <span class="num">{{ c.steps.length }}</span> 步
              <span class="tag ai" v-if="aiCount(c)" style="margin-left: 6px">AI {{ aiCount(c) }}</span>
            </td>
            <td>
              <template v-if="c.lastRun">
                <RouterLink :to="`/runs/${c.lastRun.id}`"><span class="tag" :class="c.lastRun.status">{{ RUN_STATUS_LABEL[c.lastRun.status] }}</span></RouterLink>
                <div class="muted num" style="font-size: 12px">{{ formatTime(c.lastRun.startedAt) }}</div>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <div class="actions">
                <button class="btn sm primary" @click="run(c)" data-test="run">▶ 运行</button>
                <RouterLink class="btn sm" :to="`/cases/${c.id}/edit`" data-test="edit">编辑</RouterLink>
                <button class="btn sm danger" @click="remove(c)" data-test="delete">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !cases.length" class="empty">还没有用例，点击右上角新建一个吧。</div>
    </div>
  </div>
</template>
