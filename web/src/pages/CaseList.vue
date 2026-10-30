<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Download, FileText, Pencil, Play, Plus, Search, ShieldCheck, Trash2 } from 'lucide-vue-next'
import { api } from '../api'
import type { TestCase } from '../../../shared/types'
import { formatTime } from '../format'
import { currentEnvId } from '../env-store'
import StatusBadge from '../ui/StatusBadge.vue'
import { confirmDialog, toast } from '../ui/feedback'

const router = useRouter()
const cases = ref<TestCase[]>([])
const picked = ref<number[]>([])
const loading = ref(true)
const error = ref('')
const q = ref('')
const kind = ref<'all' | 'ai' | 'api' | 'code'>('all')
const result = ref<'all' | 'failed' | 'passed' | 'none'>('all')

async function load() {
  try {
    cases.value = await api.listCases()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const aiCount = (c: TestCase) => c.steps.filter((s) => s.type.startsWith('ai_')).length
const apiCount = (c: TestCase) => c.steps.filter((s) => s.type === 'api').length
const codeCount = (c: TestCase) => c.steps.filter((s) => s.type === 'code').length

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return cases.value.filter((c) => {
    if (kw && !`${c.name} ${c.description} ${c.url}`.toLowerCase().includes(kw)) return false
    if (kind.value === 'ai' && !aiCount(c)) return false
    if (kind.value === 'api' && !apiCount(c)) return false
    if (kind.value === 'code' && (aiCount(c) || apiCount(c))) return false
    const s = c.lastRun?.status
    if (result.value === 'failed' && s !== 'failed' && s !== 'error') return false
    if (result.value === 'passed' && s !== 'passed') return false
    if (result.value === 'none' && s) return false
    return true
  })
})
const allPicked = computed(() => filtered.value.length > 0 && filtered.value.every((c) => picked.value.includes(c.id)))
function togglePickAll() {
  picked.value = allPicked.value ? [] : filtered.value.map((c) => c.id)
}

async function guard<T>(fn: () => Promise<T>) {
  error.value = ''
  try {
    return await fn()
  } catch (e: any) {
    error.value = e.message
  }
}
const run = (c: TestCase) => guard(async () => router.push(`/runs/${(await api.runCase(c.id)).runId}`))
const robustness = (c: TestCase) => guard(async () => router.push(`/batches/${(await api.robustness(c.id)).batchId}`))
const runPicked = () => guard(async () => router.push(`/batches/${(await api.runBatch(picked.value)).batchId}`))
async function remove(c: TestCase) {
  const ok = await confirmDialog({ title: `删除用例“${c.name}”？`, body: '该用例的运行记录也会一并删除，操作不可恢复。', okText: '删除', danger: true })
  if (!ok) return
  await api.deleteCase(c.id)
  picked.value = picked.value.filter((id) => id !== c.id)
  toast('用例已删除')
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>用例管理</h1>
        <div class="sub">一个用例 = 目标 URL + 步骤；步骤可以是自然语言（视觉模型执行）、Playwright 代码或接口请求，可混写。</div>
      </div>
      <div class="head-actions">
        <button class="btn" :disabled="!picked.length" @click="runPicked" data-test="run-picked"><Play :size="14" />批量运行所选（{{ picked.length }}）</button>
        <RouterLink class="btn primary" to="/cases/new" data-test="new-case"><Plus :size="15" />新建用例</RouterLink>
      </div>
    </div>
    <div v-if="error" class="alert error" data-test="list-error"><AlertCircle :size="16" />{{ error }}</div>

    <div class="card flush">
      <div class="toolbar">
        <div class="search"><Search :size="14" /><input v-model="q" placeholder="搜索名称、描述或 URL" data-test="case-search" /></div>
        <div class="chips" role="group" aria-label="步骤类型">
          <button v-for="[k, l] in [['all', '全部'], ['ai', '含 AI'], ['api', '含接口'], ['code', '纯代码']]" :key="k" :class="{ on: kind === k }" @click="kind = k as any">{{ l }}</button>
        </div>
        <div class="chips" role="group" aria-label="最近结果">
          <button v-for="[k, l] in [['all', '全部结果'], ['failed', '失败'], ['passed', '通过'], ['none', '未运行']]" :key="k" :class="{ on: result === k }" @click="result = k as any" :data-test="`filter-${k}`">{{ l }}</button>
        </div>
        <span class="muted num" style="margin-left: auto; font-size: 12px">{{ filtered.length }} / {{ cases.length }}</span>
      </div>
      <table class="table" data-test="case-table">
        <thead>
          <tr>
            <th style="width: 40px"><input type="checkbox" :checked="allPicked" @change="togglePickAll" aria-label="全选" /></th>
            <th>用例</th>
            <th style="width: 190px">步骤构成</th>
            <th style="width: 200px">目标</th>
            <th style="width: 150px">最近运行</th>
            <th style="width: 190px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.id" data-test="case-row">
            <td><input type="checkbox" :value="c.id" v-model="picked" data-test="pick" :aria-label="`选择 ${c.name}`" /></td>
            <td>
              <RouterLink :to="`/cases/${c.id}/edit`" class="row-title" data-test="case-name">{{ c.name }}</RouterLink>
              <div class="row-sub" v-if="c.description">{{ c.description }}</div>
            </td>
            <td>
              <div class="steps">
                <span class="tag code" v-if="codeCount(c)" title="Playwright 代码步骤">代码 {{ codeCount(c) }}</span>
                <span class="tag ai" v-if="aiCount(c)" title="自然语言步骤">AI {{ aiCount(c) }}</span>
                <span class="tag api" v-if="apiCount(c)" title="接口步骤">接口 {{ apiCount(c) }}</span>
              </div>
            </td>
            <td class="num url" :title="c.url">{{ c.url || '纯接口用例' }}</td>
            <td>
              <template v-if="c.lastRun">
                <RouterLink :to="`/runs/${c.lastRun.id}`"><StatusBadge :status="c.lastRun.status" size="sm" /></RouterLink>
                <div class="row-sub num">{{ formatTime(c.lastRun.startedAt) }}</div>
              </template>
              <span v-else class="muted">未运行</span>
            </td>
            <td>
              <div class="actions">
                <button class="btn sm primary" @click="run(c)" data-test="run"><Play :size="13" />运行</button>
                <button class="icon-btn" v-if="c.steps.some((s) => s.type !== 'api')" @click="robustness(c)" data-test="robustness" title="鲁棒性对比：在无变更、去掉测试标记、更换视觉样式下各运行一次"><ShieldCheck :size="16" /></button>
                <a class="icon-btn" :href="`/api/cases/${c.id}/export${currentEnvId ? `?envId=${currentEnvId}` : ''}`" data-test="export" title="导出为 Playwright 测试文件（按当前环境展开）"><Download :size="16" /></a>
                <RouterLink class="icon-btn" :to="`/cases/${c.id}/edit`" data-test="edit" title="编辑"><Pencil :size="15" /></RouterLink>
                <button class="icon-btn danger" @click="remove(c)" data-test="delete" title="删除"><Trash2 :size="15" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="loading" style="padding: 18px"><div class="skeleton" v-for="i in 3" :key="i" style="margin: 10px 0"></div></div>
      <div v-else-if="!cases.length" class="empty">
        <FileText :size="32" />
        <div>还没有用例</div>
        <RouterLink class="btn primary" to="/cases/new"><Plus :size="15" />新建第一个用例</RouterLink>
      </div>
      <div v-else-if="!filtered.length" class="empty">没有符合条件的用例</div>
    </div>
  </div>
</template>

<style scoped>
.steps { display: flex; gap: 4px; flex-wrap: wrap; }
.url { font-size: 12px; color: var(--muted); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
