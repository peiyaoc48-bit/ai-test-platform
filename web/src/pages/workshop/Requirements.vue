<script setup lang="ts">
import { ClipboardCheck, Plus, Trash2, X } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { canEdit } from '../../session'
import { confirmDialog, toast } from '../../ui/feedback'
import { formatTime } from '../../format'
import { pct } from './fmt'
import type { RequirementSummary } from '../../../../shared/types'

const router = useRouter()
const list = ref<RequirementSummary[]>([])
const loaded = ref(false)
const creating = ref(false)
const form = ref({ name: '', targetUrl: '{{DEMO}}/index.html', content: '' })
const error = ref('')
const saving = ref(false)

async function load() {
  list.value = await api.listRequirements()
  loaded.value = true
}
async function create() {
  error.value = ''
  saving.value = true
  try {
    const r = await api.createRequirement(form.value)
    toast('需求已创建，下一步：解析需求点')
    router.push(`/workshop/requirements/${r.id}`)
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
async function remove(r: RequirementSummary) {
  const ok = await confirmDialog({
    title: `删除需求“${r.name}”？`,
    body: '会同时删除它的需求点、生成批次和草稿审核记录；已入库的用例保留，但不再关联需求。',
    okText: '删除',
    danger: true,
  })
  if (!ok) return
  await api.deleteRequirement(r.id)
  toast('需求已删除')
  await load()
}
onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>用例工坊</h1>
        <div class="sub">
          需求文档 → 解析为带出处的需求点 → 按批次生成用例草稿 → 逐条审核入库。每批记录模型与 Prompt 版本，统计采纳率；覆盖矩阵区分“已关联”和“已验证”。
        </div>
      </div>
      <button v-if="canEdit && !creating" class="btn primary" @click="creating = true" data-test="new-requirement"><Plus :size="15" />新建需求</button>
    </div>

    <div v-if="creating" class="card" style="margin-bottom: 16px" data-test="requirement-form">
      <div class="card-head" style="padding: 0 0 12px; border: 0">
        <h2>新建需求</h2>
        <button class="icon-btn" title="取消" @click="creating = false"><X :size="16" /></button>
      </div>
      <div v-if="error" class="alert error">{{ error }}</div>
      <div class="grid2">
        <div class="field"><label>名称</label><input class="input" v-model="form.name" placeholder="如：TodoLite 登录与待办管理" data-test="req-name" /></div>
        <div class="field">
          <label>目标 URL</label>
          <input class="input" v-model="form.targetUrl" data-test="req-url" />
        </div>
      </div>
      <div class="field">
        <label>需求原文（≤ 20000 字）</label>
        <textarea class="textarea" v-model="form.content" rows="10" placeholder="粘贴 PRD 或需求说明的文字内容" data-test="req-content"></textarea>
      </div>
      <div class="hint">目标 URL 可用 <code v-pre>{{DEMO}}</code> 等环境变量占位符，生成的用例都从这个地址开始。</div>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px">
        <button class="btn" @click="creating = false">取消</button>
        <button class="btn primary" :disabled="saving" @click="create" data-test="save-requirement">创建</button>
      </div>
    </div>

    <div class="card flush">
      <table class="table" data-test="requirement-table">
        <thead>
          <tr>
            <th style="width: 56px">ID</th>
            <th>需求</th>
            <th style="width: 80px">需求点</th>
            <th style="width: 80px">批次</th>
            <th style="width: 90px">待审核</th>
            <th style="width: 170px">已关联 / 已验证</th>
            <th style="width: 150px">更新时间</th>
            <th style="width: 60px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in list" :key="r.id" data-test="requirement-row">
            <td class="num muted">#{{ r.id }}</td>
            <td>
              <RouterLink :to="`/workshop/requirements/${r.id}`" class="row-title">{{ r.name }}</RouterLink>
              <div class="muted" style="font-size: 12px">v{{ r.version }} · {{ r.content.length }} 字</div>
            </td>
            <td class="num">{{ r.points }}</td>
            <td class="num">{{ r.batches }}</td>
            <td><span v-if="r.pendingDrafts" class="tag running">{{ r.pendingDrafts }} 条</span><span v-else class="muted">—</span></td>
            <td>
              <div class="cov" v-if="r.linkedRate !== null" :title="`已关联 ${pct(r.linkedRate)}，已验证 ${pct(r.verifiedRate)}`">
                <div class="cov-bar"><i class="l" :style="{ width: pct(r.linkedRate) }"></i><i class="v" :style="{ width: pct(r.verifiedRate) }"></i></div>
                <span class="num">{{ pct(r.linkedRate, 0) }} / {{ pct(r.verifiedRate, 0) }}</span>
              </div>
              <span v-else class="muted">未解析</span>
            </td>
            <td class="num muted" style="white-space: nowrap">{{ formatTime(r.updatedAt) }}</td>
            <td><button v-if="canEdit" class="icon-btn danger" title="删除" @click="remove(r)"><Trash2 :size="15" /></button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="loaded && !list.length" class="empty">
        <ClipboardCheck :size="30" />
        <div>还没有需求。新建一个需求，粘贴需求文档开始。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cov { display: flex; align-items: center; gap: 8px; }
.cov-bar { position: relative; flex: 1; height: 6px; border-radius: 3px; background: #eef1f6; overflow: hidden; min-width: 60px; }
.cov-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
.cov-bar .l { background: #b9cdf3; }
.cov-bar .v { background: var(--pass); }
.cov .num { font-size: 12px; color: var(--text-2); white-space: nowrap; }
@media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
</style>
