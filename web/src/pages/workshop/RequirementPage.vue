<script setup lang="ts">
import { AlertTriangle, Download, GitCompare, ListChecks, Loader2, Pencil, Plus, Save, Sparkles, Trash2, Wand2, X } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api'
import { canEdit } from '../../session'
import { toast } from '../../ui/feedback'
import { formatDuration, formatTime } from '../../format'
import { COVERAGE_TAG, batchName, pct, propParts } from './fmt'
import StatusBadge from '../../ui/StatusBadge.vue'
import {
  COVERAGE_LABEL,
  type Coverage,
  type CoverageStatus,
  type Priority,
  type PromptInfo,
  type ReqPointInput,
  type RequirementDetail,
} from '../../../../shared/types'

const props = defineProps<{ id: string }>()
const route = useRoute()
const router = useRouter()
type Tab = 'points' | 'batches' | 'coverage' | 'source'
const TABS: { key: Tab; label: string }[] = [
  { key: 'points', label: '需求点' },
  { key: 'batches', label: '生成批次' },
  { key: 'coverage', label: '覆盖矩阵' },
  { key: 'source', label: '需求原文' },
]
const tab = ref<Tab>((route.query.tab as Tab) || 'points')
watch(tab, (t) => router.replace({ query: { ...route.query, tab: t } }))

const req = ref<RequirementDetail | null>(null)
const cov = ref<Coverage | null>(null)
const prompts = ref<PromptInfo[]>([])
const busy = ref<'' | 'parse' | 'gen' | 'save'>('')
const error = ref('')

async function load() {
  const id = Number(props.id)
  ;[req.value, cov.value] = await Promise.all([api.getRequirement(id), api.coverage(id)])
}
onMounted(async () => {
  await load()
  prompts.value = await api.prompts()
  parseVersion.value = latest('parse')
  genVersion.value = latest('gen')
  source.value = { name: req.value!.name, targetUrl: req.value!.targetUrl, content: req.value!.content }
})
const latest = (kind: PromptInfo['kind']) => prompts.value.filter((p) => p.kind === kind).at(-1)?.version ?? 'v1'
const promptsOf = (kind: PromptInfo['kind']) => prompts.value.filter((p) => p.kind === kind)

async function act<T>(kind: typeof busy.value, fn: () => Promise<T>) {
  error.value = ''
  busy.value = kind
  try {
    return await fn()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

// —— 需求点 ——
const parseVersion = ref('v1')
const lastParse = computed(() => req.value?.parses[0] ?? null)
const stale = computed(() => !!req.value && !!lastParse.value && lastParse.value.requirementVersion !== req.value.version)
const badExcerpts = computed(() => req.value?.points.filter((p) => !p.excerptFound).length ?? 0)

async function parse() {
  const res = await act('parse', () => api.parseRequirement(Number(props.id), parseVersion.value))
  if (!res) return
  toast(`解析完成：新增 ${res.parse.added}，沿用 ${res.parse.kept}，移除 ${res.parse.removed}`)
  await load()
}

const editing = ref(false)
const draftPoints = ref<(ReqPointInput & { code?: string })[]>([])
function startEdit() {
  draftPoints.value = req.value!.points.map((p) => ({ id: p.id, code: p.code, title: p.title, detail: p.detail, priority: p.priority, sourceExcerpt: p.sourceExcerpt }))
  editing.value = true
}
async function savePointsEdit() {
  const res = await act('save', () => api.savePoints(Number(props.id), draftPoints.value.map(({ code, ...p }) => p)))
  if (!res) return
  editing.value = false
  toast('需求点已保存')
  await load()
}

// —— 生成批次 ——
const genVersion = ref('v1')
const genScope = ref<'all' | 'uncovered' | 'selected'>('all')
const selected = ref<Set<number>>(new Set())
const scopeIds = computed(() => [...selected.value])
const uncoveredCount = computed(() => cov.value?.counts.uncovered ?? 0)

async function generate() {
  const scope = genScope.value === 'selected' ? scopeIds.value : genScope.value
  const b = await act('gen', () => api.generateBatch(Number(props.id), scope, genVersion.value))
  if (!b) return
  toast(`已生成 ${b.drafts.length} 条草稿，进入审核`)
  router.push(`/workshop/batches/${b.id}/review`)
}
function generateFor(ids: number[]) {
  selected.value = new Set(ids)
  genScope.value = 'selected'
  tab.value = 'batches'
}

const compareSel = ref<number[]>([])
function toggleCompare(id: number) {
  compareSel.value = compareSel.value.includes(id) ? compareSel.value.filter((x) => x !== id) : [...compareSel.value, id].slice(-2)
}
const compareLink = computed(() => {
  const [a, b] = [...compareSel.value].sort((x, y) => x - y)
  return `/workshop/compare?a=${a}&b=${b}`
})

// —— 覆盖矩阵 ——
const covFilter = ref<CoverageStatus | 'all'>('all')
const covRows = computed(() => (cov.value?.rows ?? []).filter((r) => covFilter.value === 'all' || r.status === covFilter.value))
const covSel = ref<Set<number>>(new Set())
function toggleCov(id: number) {
  const s = new Set(covSel.value)
  s.has(id) ? s.delete(id) : s.add(id)
  covSel.value = s
}

// —— 原文 ——
const source = ref({ name: '', targetUrl: '', content: '' })
async function saveSource() {
  const r = await act('save', () => api.updateRequirement(Number(props.id), source.value))
  if (!r) return
  toast(r.version !== req.value!.version ? `已保存为 v${r.version}，请重新解析需求点` : '已保存')
  await load()
}

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2']
const STATUSES: CoverageStatus[] = ['uncovered', 'linked', 'verified', 'failed']
</script>

<template>
  <div class="page wide" v-if="req && cov">
    <div class="page-head">
      <div>
        <h1>{{ req.name }}</h1>
        <div class="meta">
          <span>版本 <b>v{{ req.version }}</b></span>
          <span>目标 URL <code>{{ req.targetUrl }}</code></span>
          <span v-if="lastParse">最近解析 <b>{{ formatTime(lastParse.createdAt) }}</b>（{{ lastParse.model }} · parse-{{ lastParse.promptVersion }}）</span>
        </div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="label">需求点</div><div class="value num">{{ cov.total }}</div><div class="foot">P0 {{ req.points.filter((p) => p.priority === 'P0').length }} · P1 {{ req.points.filter((p) => p.priority === 'P1').length }} · P2 {{ req.points.filter((p) => p.priority === 'P2').length }}</div></div>
      <div class="kpi"><div class="label">已关联用例</div><div class="value num">{{ pct(cov.total ? (cov.total - cov.counts.uncovered) / cov.total : null) }}</div><div class="foot">{{ cov.total - cov.counts.uncovered }} / {{ cov.total }} 个需求点</div></div>
      <div class="kpi"><div class="label">已验证（运行通过）</div><div class="value num" style="color: var(--pass)">{{ pct(cov.total ? cov.counts.verified / cov.total : null) }}</div><div class="foot">关联 ≠ 通过：以最近一次运行结果为准</div></div>
      <div class="kpi"><div class="label">生成批次</div><div class="value num">{{ req.batches.length }}</div><div class="foot">待审核草稿 {{ req.batches.reduce((n, b) => n + b.stats.total - b.stats.reviewed, 0) }} 条</div></div>
    </div>

    <div v-if="cov.p0Uncovered.length" class="alert error" data-test="p0-alert">
      <AlertTriangle :size="16" />
      <div>
        <b>P0 需求点未覆盖：</b>{{ cov.p0Uncovered.map((p) => `${p.code} ${p.title}`).join('；') }}
        <button v-if="canEdit" class="btn link" @click="generateFor(cov.p0Uncovered.map((p) => p.id))">只针对这些生成 →</button>
      </div>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="tabs">
      <button v-for="t in TABS" :key="t.key" class="tab" :class="{ on: tab === t.key }" @click="tab = t.key" :data-test="`tab-${t.key}`">{{ t.label }}</button>
    </div>

    <!-- 需求点 -->
    <div v-if="tab === 'points'" class="card flush">
      <div class="card-head">
        <h2>需求点 <span class="muted" style="font-weight: 400">（{{ req.points.length }}）</span></h2>
        <div class="head-actions" v-if="canEdit && !editing">
          <select class="select sm" v-model="parseVersion" title="解析用的 Prompt 版本">
            <option v-for="p in promptsOf('parse')" :key="p.version" :value="p.version">parse-{{ p.version }}</option>
          </select>
          <button class="btn sm" :class="{ primary: !req.points.length || stale }" :disabled="!!busy" @click="parse" data-test="parse">
            <Loader2 v-if="busy === 'parse'" :size="13" class="spin" /><Wand2 v-else :size="13" />{{ req.points.length ? '重新解析' : 'AI 解析需求点' }}
          </button>
          <button v-if="req.points.length" class="btn sm" @click="startEdit" data-test="edit-points"><Pencil :size="13" />编辑</button>
        </div>
        <div class="head-actions" v-if="editing">
          <button class="btn sm" @click="editing = false"><X :size="13" />取消</button>
          <button class="btn sm primary" :disabled="!!busy" @click="savePointsEdit" data-test="save-points"><Save :size="13" />保存</button>
        </div>
      </div>
      <div v-if="stale" class="alert warn inset">需求原文已更新到 v{{ req.version }}，需求点还是 v{{ lastParse!.requirementVersion }} 解析的，建议重新解析（相似的需求点会沿用编号和用例关联）。</div>
      <div v-if="badExcerpts && !editing" class="alert warn inset">
        有 {{ badExcerpts }} 个需求点的原文摘录在需求文档中找不到（标红），可能是模型编造或改写的，请核对后编辑或删除。
      </div>

      <table class="table" v-if="!editing" data-test="point-table">
        <thead><tr><th style="width: 90px">编号</th><th style="width: 60px">优先级</th><th>需求点</th><th style="width: 38%">原文摘录</th></tr></thead>
        <tbody>
          <tr v-for="p in req.points" :key="p.id" data-test="point-row">
            <td class="num">{{ p.code }}</td>
            <td><span class="prio" :class="p.priority">{{ p.priority }}</span></td>
            <td>
              <div>{{ p.title }}</div>
              <div v-if="p.detail" class="muted" style="font-size: 12px">{{ p.detail }}</div>
              <div v-if="p.parseId === null" class="muted" style="font-size: 11.5px">人工添加</div>
            </td>
            <td>
              <div class="excerpt" :class="{ bad: !p.excerptFound }" :title="p.excerptFound ? '已在原文中找到' : '原文中找不到这段摘录'">
                {{ p.sourceExcerpt || '（无摘录）' }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="edit-list">
        <div v-for="(p, i) in draftPoints" :key="p.id ?? `new-${i}`" class="edit-row">
          <span class="num muted code">{{ p.code ?? '新' }}</span>
          <select class="select sm" v-model="p.priority" style="width: 64px"><option v-for="x in PRIORITIES" :key="x">{{ x }}</option></select>
          <div class="edit-fields">
            <input class="input" v-model="p.title" placeholder="需求点标题" />
            <input class="input" v-model="p.detail" placeholder="补充说明（可空）" />
            <input class="input" v-model="p.sourceExcerpt" placeholder="原文摘录（从需求文档复制）" />
          </div>
          <button class="icon-btn danger" title="删除" @click="draftPoints.splice(i, 1)"><Trash2 :size="15" /></button>
        </div>
        <button class="btn sm" @click="draftPoints.push({ title: '', detail: '', priority: 'P1', sourceExcerpt: '' })"><Plus :size="13" />添加需求点</button>
      </div>
      <div v-if="!req.points.length" class="empty"><ListChecks :size="30" /><div>还没有需求点。点击右上角“AI 解析需求点”。</div></div>
    </div>

    <!-- 生成批次 -->
    <template v-if="tab === 'batches'">
      <div class="card gen" v-if="canEdit">
        <div class="gen-row">
          <div class="field" style="margin: 0">
            <label>范围</label>
            <div class="seg">
              <label :class="{ on: genScope === 'all' }"><input type="radio" value="all" v-model="genScope" />全部（{{ req.points.length }}）</label>
              <label :class="{ on: genScope === 'uncovered' }"><input type="radio" value="uncovered" v-model="genScope" />未覆盖（{{ uncoveredCount }}）</label>
              <label :class="{ on: genScope === 'selected' }"><input type="radio" value="selected" v-model="genScope" />指定（{{ selected.size }}）</label>
            </div>
          </div>
          <div class="field" style="margin: 0">
            <label>Prompt 版本</label>
            <select class="select" v-model="genVersion" data-test="gen-version">
              <option v-for="p in promptsOf('gen')" :key="p.version" :value="p.version">gen-{{ p.version }}：{{ p.summary }}</option>
            </select>
          </div>
          <button class="btn primary" :disabled="!!busy || !req.points.length || (genScope === 'selected' && !selected.size)" @click="generate" data-test="generate-batch">
            <Loader2 v-if="busy === 'gen'" :size="14" class="spin" /><Sparkles v-else :size="14" />{{ busy === 'gen' ? '生成中…' : '生成一批' }}
          </button>
        </div>
        <div v-if="genScope === 'selected'" class="pick">
          <label v-for="p in req.points" :key="p.id" class="chip" :class="{ on: selected.has(p.id) }">
            <input type="checkbox" :checked="selected.has(p.id)" @change="selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id)" />
            {{ p.code }} {{ p.title }}
          </label>
        </div>
        <div class="hint">生成结果都是草稿，不进入用例列表、不计入覆盖率，审核通过后才入库。改 Prompt 时请新建 <code>server/ai/prompts/gen-vN.md</code>，不要原地修改，否则历史批次不可比。</div>
      </div>

      <div class="card flush">
        <div class="card-head">
          <h2>批次（{{ req.batches.length }}）</h2>
          <RouterLink v-if="compareSel.length === 2" class="btn sm" :to="compareLink" data-test="compare"><GitCompare :size="13" />对比所选两批</RouterLink>
          <span v-else class="muted" style="font-size: 12px">勾选两批可对比采纳率</span>
        </div>
        <table class="table" data-test="batch-table">
          <thead>
            <tr>
              <th style="width: 34px"></th><th style="width: 90px">批次</th><th>Prompt / 模型</th><th style="width: 70px">范围</th><th style="width: 120px">审核进度</th>
              <th style="width: 190px">采纳率（95% CI）</th><th style="width: 110px">首次运行通过</th><th style="width: 80px">新增关联</th><th style="width: 90px">Token</th><th style="width: 150px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in req.batches" :key="b.id" data-test="gen-batch-row">
              <td><input type="checkbox" :checked="compareSel.includes(b.id)" @change="toggleCompare(b.id)" /></td>
              <td><RouterLink class="num" :to="`/workshop/batches/${b.id}`">{{ batchName(b.seq) }}</RouterLink><div class="muted" style="font-size: 11.5px">{{ formatTime(b.createdAt) }}</div></td>
              <td><span class="tag ai">gen-{{ b.promptVersion }}</span> <span class="muted" style="font-size: 12px">{{ b.model }}</span></td>
              <td class="num">{{ b.scope.length }}</td>
              <td>
                <div class="progress"><i :style="{ width: pct(b.stats.total ? b.stats.reviewed / b.stats.total : 0) }"></i></div>
                <span class="num" style="font-size: 12px">{{ b.stats.reviewed }} / {{ b.stats.total }}</span>
              </td>
              <td>
                <template v-if="b.stats.adoption.n">
                  <b class="num">{{ propParts(b.stats.adoption).rate }}</b>
                  <span class="num muted" style="font-size: 12px"> {{ propParts(b.stats.adoption).frac }} · {{ propParts(b.stats.adoption).ci }}</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td class="num">{{ b.stats.firstRun.n ? `${propParts(b.stats.firstRun).rate}（${propParts(b.stats.firstRun).frac}）` : '—' }}</td>
              <td class="num">+{{ b.stats.newlyLinked }}</td>
              <td class="num muted">{{ b.tokens.toLocaleString() }}</td>
              <td>
                <div class="actions">
                  <RouterLink v-if="canEdit && b.stats.reviewed < b.stats.total" class="btn sm primary" :to="`/workshop/batches/${b.id}/review`">审核</RouterLink>
                  <RouterLink class="btn sm" :to="`/workshop/batches/${b.id}`">详情</RouterLink>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!req.batches.length" class="empty">还没有生成批次。</div>
      </div>
    </template>

    <!-- 覆盖矩阵 -->
    <template v-if="tab === 'coverage'">
      <div class="card" v-if="cov.timeline.length">
        <h2 style="margin: 0 0 10px">按批次累计的需求点关联率</h2>
        <div class="timeline">
          <div v-for="t in cov.timeline" :key="t.batchId" class="tl">
            <div class="tl-bar"><i :style="{ height: pct(t.rate) }"></i></div>
            <div class="num tl-v">{{ pct(t.rate, 0) }}</div>
            <RouterLink class="num tl-k" :to="`/workshop/batches/${t.batchId}`">{{ batchName(t.seq) }}</RouterLink>
            <div class="muted tl-k">gen-{{ t.promptVersion }}</div>
          </div>
        </div>
        <div class="hint">只统计由生成批次入库的用例；关联不代表通过，是否通过看下表的“覆盖状态”。</div>
      </div>

      <div class="card flush">
        <div class="card-head">
          <div class="chips">
            <button :class="{ on: covFilter === 'all' }" @click="covFilter = 'all'">全部 {{ cov.total }}</button>
            <button v-for="s in STATUSES" :key="s" :class="{ on: covFilter === s }" @click="covFilter = s" :data-test="`cov-filter-${s}`">
              {{ COVERAGE_LABEL[s] }} {{ cov.counts[s] }}
            </button>
          </div>
          <div class="head-actions">
            <button v-if="canEdit && covSel.size" class="btn sm primary" @click="generateFor([...covSel])"><Sparkles :size="13" />只针对选中的 {{ covSel.size }} 个生成</button>
            <a class="btn sm" :href="`/api/requirements/${req.id}/coverage.csv`"><Download :size="13" />导出 CSV</a>
          </div>
        </div>
        <table class="table" data-test="coverage-table">
          <thead><tr><th style="width: 34px"></th><th style="width: 90px">编号</th><th style="width: 60px">优先级</th><th>需求点</th><th style="width: 120px">覆盖状态</th><th style="width: 40%">关联用例（最近一次运行）</th></tr></thead>
          <tbody>
            <tr v-for="r in covRows" :key="r.point.id" data-test="coverage-row">
              <td><input type="checkbox" :checked="covSel.has(r.point.id)" @change="toggleCov(r.point.id)" /></td>
              <td class="num">{{ r.point.code }}</td>
              <td><span class="prio" :class="r.point.priority">{{ r.point.priority }}</span></td>
              <td>{{ r.point.title }}</td>
              <td><span class="tag" :class="COVERAGE_TAG[r.status]">{{ COVERAGE_LABEL[r.status] }}</span></td>
              <td>
                <div v-for="c in r.cases" :key="c.id" class="linked">
                  <RouterLink :to="`/cases/${c.id}/edit`">#{{ c.id }} {{ c.name }}</RouterLink>
                  <RouterLink v-if="c.lastRunId" :to="`/runs/${c.lastRunId}`"><StatusBadge :status="c.lastStatus!" size="sm" /></RouterLink>
                  <span v-else class="muted" style="font-size: 12px">未运行</span>
                </div>
                <span v-if="!r.cases.length" class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!cov.rows.length" class="empty">还没有需求点。</div>
      </div>
    </template>

    <!-- 原文 -->
    <div v-if="tab === 'source'" class="card">
      <div class="grid2">
        <div class="field"><label>名称</label><input class="input" v-model="source.name" :disabled="!canEdit" /></div>
        <div class="field"><label>目标 URL</label><input class="input" v-model="source.targetUrl" :disabled="!canEdit" /></div>
      </div>
      <div class="field">
        <label>需求原文（修改后版本号 + 1，需要重新解析）</label>
        <textarea class="textarea" v-model="source.content" rows="18" :disabled="!canEdit" data-test="source-content"></textarea>
      </div>
      <div v-if="canEdit" style="display: flex; justify-content: flex-end">
        <button class="btn primary" :disabled="!!busy" @click="saveSource"><Save :size="14" />保存</button>
      </div>
      <div v-if="req.parses.length" style="margin-top: 16px">
        <h2 style="font-size: 14px">解析记录</h2>
        <table class="table">
          <thead><tr><th>时间</th><th>原文版本</th><th>Prompt</th><th>模型</th><th>新增 / 沿用 / 移除</th><th>Token</th><th>耗时</th></tr></thead>
          <tbody>
            <tr v-for="p in req.parses" :key="p.id">
              <td class="num">{{ formatTime(p.createdAt) }}</td>
              <td class="num">v{{ p.requirementVersion }}</td>
              <td>parse-{{ p.promptVersion }}</td>
              <td class="muted">{{ p.model }}</td>
              <td class="num">{{ p.added }} / {{ p.kept }} / {{ p.removed }}</td>
              <td class="num">{{ p.tokens.toLocaleString() }}</td>
              <td class="num">{{ formatDuration(p.durationMs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page.wide { max-width: 1440px; }
.meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); font-size: 12.5px; margin-top: 6px; }
.meta b { color: var(--text-2); font-weight: 500; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
.tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; font: inherit; font-size: 13.5px; color: var(--muted); cursor: pointer; margin-bottom: -1px; }
.tab.on { color: var(--brand); border-bottom-color: var(--brand); font-weight: 500; }
.alert.inset { margin: 0 16px 12px; }
.prio { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: #eef1f6; color: var(--muted); }
.prio.P0 { background: var(--fail-soft); color: var(--fail); }
.prio.P1 { background: var(--skip-soft); color: var(--skip); }
.excerpt { font-size: 12.5px; color: var(--text-2); background: #f7f9fc; border-left: 3px solid #cdd6e4; padding: 4px 8px; border-radius: 0 4px 4px 0; }
.excerpt.bad { background: var(--fail-soft); border-left-color: var(--fail); color: #9b2a17; }
.edit-list { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
.edit-row { display: flex; gap: 8px; align-items: flex-start; }
.edit-row .code { width: 64px; padding-top: 6px; font-size: 12.5px; }
.edit-fields { flex: 1; display: grid; grid-template-columns: 1.2fr 1fr 1.2fr; gap: 6px; }
.gen { margin-bottom: 16px; }
.gen-row { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; }
.gen-row .select { min-width: 300px; }
.seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 7px; overflow: hidden; }
.seg label { padding: 0 12px; height: 32px; display: flex; align-items: center; font-size: 13px; cursor: pointer; border-right: 1px solid var(--border); }
.seg label:last-child { border-right: 0; }
.seg label.on { background: var(--brand-soft); color: var(--brand); font-weight: 500; }
.seg input { display: none; }
.pick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; max-height: 180px; overflow: auto; }
.select.sm { width: auto; height: 28px; padding: 2px 8px; font-size: 12.5px; }
.gen-row .field .select { width: auto; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--border-strong); background: #fff; font: inherit; font-size: 12.5px; cursor: pointer; color: var(--text-2); }
.chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
.chip input { display: none; }
.progress { height: 4px; background: #eef1f6; border-radius: 2px; overflow: hidden; margin-bottom: 3px; }
.progress i { display: block; height: 100%; background: var(--brand); }
.actions { display: flex; gap: 6px; justify-content: flex-end; }
.timeline { display: flex; gap: 22px; align-items: flex-end; overflow-x: auto; padding-bottom: 4px; }
.tl { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 60px; }
.tl-bar { width: 30px; height: 110px; background: #eef1f6; border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
.tl-bar i { display: block; width: 100%; background: #6d93e0; }
.tl-v { font-weight: 600; font-size: 13px; }
.tl-k { font-size: 11.5px; }
.linked { display: flex; align-items: center; gap: 8px; justify-content: space-between; padding: 2px 0; font-size: 12.5px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) { .edit-fields { grid-template-columns: 1fr; } .grid2 { grid-template-columns: 1fr; } .gen-row .select { min-width: 0; width: 100%; } }
</style>
