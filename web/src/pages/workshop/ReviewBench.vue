<script setup lang="ts">
import { Check, CheckCircle2, ChevronDown, ChevronUp, Pencil, Trash2, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../../api'
import { canEdit } from '../../session'
import { toast } from '../../ui/feedback'
import StepsEditor from '../../components/StepsEditor.vue'
import { batchName, pct } from './fmt'
import {
  DISCARD_REASON_LABEL,
  STEP_TYPE_LABEL,
  VERDICT_LABEL,
  type DiscardReason,
  type Draft,
  type GenBatchDetail,
  type Step,
} from '../../../../shared/types'

const props = defineProps<{ id: string }>()
const batch = ref<GenBatchDetail | null>(null)
const onlyPending = ref(true)
const currentId = ref<number | null>(null)
const mode = ref<'view' | 'edit' | 'discard'>('view')
const busy = ref(false)
const error = ref('')

// 编辑中的终稿与关联需求点
const form = ref<{ name: string; description: string; steps: Step[] }>({ name: '', description: '', steps: [] })
const pointSel = ref<number[]>([])
const reason = ref<DiscardReason | null>(null)
const note = ref('')
const REASONS = Object.keys(DISCARD_REASON_LABEL) as DiscardReason[]

/** 置信度从低到高：先看最可能有问题的；没有置信度的排最后 */
const queue = computed(() =>
  [...(batch.value?.drafts ?? [])]
    .filter((d) => !onlyPending.value || d.verdict === 'pending' || d.id === currentId.value)
    .sort((a, b) => (a.confidence ?? 2) - (b.confidence ?? 2) || a.id - b.id),
)
const current = computed(() => batch.value?.drafts.find((d) => d.id === currentId.value) ?? null)
const pointsById = computed(() => new Map(batch.value?.points.map((p) => [p.id, p]) ?? []))
const scopePoints = computed(() => batch.value?.points.filter((p) => batch.value!.scope.includes(p.id) && p.status === 'active') ?? [])
const reviewed = computed(() => batch.value?.drafts.filter((d) => d.verdict !== 'pending').length ?? 0)
const done = computed(() => !!batch.value && reviewed.value === batch.value.drafts.length)
const pointsChanged = computed(() => !!current.value && [...pointSel.value].sort().join() !== [...current.value.pointIds].sort().join())

function select(d: Draft | null) {
  currentId.value = d?.id ?? null
  mode.value = 'view'
  error.value = ''
  if (!d) return
  pointSel.value = [...(d.final?.pointIds ?? d.pointIds)]
  form.value = { name: d.name, description: d.description, steps: d.steps.map((s) => ({ ...s })) }
  reason.value = null
  note.value = ''
  nextTick(() => document.querySelector(`[data-draft="${d.id}"]`)?.scrollIntoView({ block: 'nearest' }))
}
function move(delta: number) {
  const list = queue.value
  const i = list.findIndex((d) => d.id === currentId.value)
  const next = list[Math.min(list.length - 1, Math.max(0, i + delta))]
  if (next) select(next)
}
function nextPending() {
  const list = [...(batch.value?.drafts ?? [])].sort((a, b) => (a.confidence ?? 2) - (b.confidence ?? 2) || a.id - b.id)
  select(list.find((d) => d.verdict === 'pending') ?? null)
}

onMounted(async () => {
  batch.value = await api.getGenBatch(Number(props.id))
  nextPending()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function togglePoint(id: number) {
  pointSel.value = pointSel.value.includes(id) ? pointSel.value.filter((x) => x !== id) : [...pointSel.value, id]
}

async function submit(verdict: 'accepted' | 'edited' | 'discarded') {
  const d = current.value
  if (!d || d.verdict !== 'pending' || busy.value) return
  error.value = ''
  busy.value = true
  try {
    const original = { name: d.name, description: d.description, url: d.url, steps: d.steps }
    const body =
      verdict === 'discarded'
        ? { verdict, reason: reason.value ?? undefined, note: note.value }
        : verdict === 'edited'
          ? { verdict, final: { ...form.value, url: d.url }, pointIds: pointSel.value }
          : // 只改了关联的需求点也算修改
            pointsChanged.value
            ? { verdict: 'edited' as const, final: original, pointIds: pointSel.value }
            : { verdict, pointIds: pointSel.value }
    const updated = await api.reviewDraft(d.id, body)
    Object.assign(d, updated)
    toast(`${VERDICT_LABEL[updated.verdict]}：${updated.final?.name ?? updated.name}`, updated.verdict === 'discarded' ? 'info' : 'success')
    nextPending()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (!canEdit.value || !current.value) return
  const typing = e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, .cm-editor') !== null)
  if (mode.value === 'edit') {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit('edited') }
    else if (e.key === 'Escape') mode.value = 'view'
    return
  }
  if (mode.value === 'discard') {
    if (e.key === 'Escape') mode.value = 'view'
    else if (!typing && /^[1-6]$/.test(e.key)) reason.value = REASONS[Number(e.key) - 1]
    else if (e.key === 'Enter' && reason.value && !(typing && e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); submit('discarded') }
    return
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return
  const k = e.key.toLowerCase()
  if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (current.value.verdict !== 'pending') return
  else if (k === 'a') submit('accepted')
  else if (k === 'e') mode.value = 'edit'
  else if (k === 'd') mode.value = 'discard'
}

const confClass = (c: number | null) => (c === null ? '' : c < 0.5 ? 'low' : c < 0.75 ? 'mid' : 'high')
const VERDICT_TAG = { pending: 'queued', accepted: 'passed', edited: 'healed', discarded: 'failed' } as const
</script>

<template>
  <div class="page wide" v-if="batch">
    <div class="page-head">
      <div>
        <h1>审核 {{ batchName(batch.seq) }} <span class="tag ai" style="vertical-align: middle">gen-{{ batch.promptVersion }}</span></h1>
        <div class="sub">AI 只负责起草：草稿必须由人判定后才入库。快捷键 <kbd>A</kbd> 通过 · <kbd>E</kbd> 修改 · <kbd>D</kbd> 废弃 · <kbd>J</kbd>/<kbd>K</kbd> 上下切换</div>
      </div>
      <div class="head-actions">
        <div class="prog">
          <div class="bar"><i :style="{ width: pct(batch.drafts.length ? reviewed / batch.drafts.length : 0) }"></i></div>
          <span class="num">{{ reviewed }} / {{ batch.drafts.length }}</span>
        </div>
        <RouterLink class="btn" :to="`/workshop/batches/${batch.id}`">批次详情</RouterLink>
      </div>
    </div>
    <div v-if="!canEdit" class="alert warn">演示站点为只读：可以查看草稿，登录后才能审核。</div>

    <div class="bench">
      <div class="card flush queue">
        <div class="queue-head">
          <span>审核队列 · 按置信度从低到高</span>
          <label class="muted"><input type="checkbox" v-model="onlyPending" /> 只看待审</label>
        </div>
        <button
          v-for="d in queue"
          :key="d.id"
          class="qi"
          :class="{ sel: d.id === currentId, [d.verdict]: true }"
          :data-draft="d.id"
          @click="select(d)"
          data-test="queue-item"
        >
          <div class="qi-1">
            <span class="conf" :class="confClass(d.confidence)">{{ d.confidence === null ? '—' : d.confidence.toFixed(2) }}</span>
            <span class="qi-name">{{ d.final?.name ?? d.name }}</span>
          </div>
          <div class="qi-2">
            <span class="tag" :class="VERDICT_TAG[d.verdict]">{{ VERDICT_LABEL[d.verdict] }}</span>
            <span class="muted">{{ d.steps.length }} 步 · {{ d.pointIds.map((p) => pointsById.get(p)?.code).join(' ') }}</span>
          </div>
        </button>
        <div v-if="!queue.length" class="empty" style="padding: 24px">没有待审核的草稿</div>
      </div>

      <div class="card detail" v-if="current">
        <div class="d-head">
          <h2>{{ current.final?.name ?? current.name }}</h2>
          <span class="tag" :class="VERDICT_TAG[current.verdict]">{{ VERDICT_LABEL[current.verdict] }}</span>
          <div class="nav">
            <button class="icon-btn" title="上一条（K）" @click="move(-1)"><ChevronUp :size="16" /></button>
            <button class="icon-btn" title="下一条（J）" @click="move(1)"><ChevronDown :size="16" /></button>
          </div>
        </div>
        <div v-if="error" class="alert error">{{ error }}</div>

        <section>
          <div class="sec-title">覆盖的需求点 <span class="muted" v-if="current.verdict === 'pending' && canEdit">（点击可增减，改动关联也算修改）</span></div>
          <div class="pts">
            <button
              v-for="p in current.verdict === 'pending' ? scopePoints : scopePoints.filter((x) => pointSel.includes(x.id))"
              :key="p.id"
              class="pt"
              :class="{ on: pointSel.includes(p.id) }"
              :disabled="current.verdict !== 'pending' || !canEdit"
              @click="togglePoint(p.id)"
              data-test="point-chip"
            >
              <b>{{ p.code }}</b> {{ p.title }}
            </button>
          </div>
          <div v-for="pid in pointSel" :key="pid" class="excerpt">
            <b>{{ pointsById.get(pid)?.code }} 原文：</b>{{ pointsById.get(pid)?.sourceExcerpt || '（无摘录）' }}
          </div>
        </section>

        <!-- 查看 -->
        <template v-if="mode !== 'edit'">
          <section v-if="current.description">
            <div class="sec-title">说明</div>
            <div class="desc">{{ current.description }}</div>
          </section>
          <section>
            <div class="sec-title">步骤<span class="muted" v-if="current.final && current.verdict === 'edited'">（终稿；原稿见下方）</span></div>
            <ol class="steps">
              <li v-for="(s, i) in current.final?.steps ?? current.steps" :key="i">
                <span class="tag" :class="s.type === 'ai_assert' ? 'passed' : 'ai'">{{ STEP_TYPE_LABEL[s.type] }}</span>
                <span>{{ s.content }}</span>
              </li>
            </ol>
          </section>
          <section v-if="current.verdict === 'edited'">
            <div class="sec-title">AI 原稿</div>
            <ol class="steps orig">
              <li v-for="(s, i) in current.steps" :key="i"><span class="tag">{{ STEP_TYPE_LABEL[s.type] }}</span><span>{{ s.content }}</span></li>
            </ol>
          </section>
          <section v-if="current.discardReason">
            <div class="sec-title">废弃原因</div>
            <div class="desc">{{ DISCARD_REASON_LABEL[current.discardReason] }}<template v-if="current.note">：{{ current.note }}</template></div>
          </section>
        </template>

        <!-- 编辑 -->
        <template v-else>
          <section>
            <div class="field"><label>用例名称</label><input class="input" v-model="form.name" data-test="edit-name" /></div>
            <div class="field"><label>说明</label><input class="input" v-model="form.description" /></div>
            <div class="sec-title">步骤</div>
            <StepsEditor v-model="form.steps" />
          </section>
        </template>

        <!-- 废弃原因 -->
        <section v-if="mode === 'discard'" class="discard" data-test="discard-panel">
          <div class="sec-title">选择废弃原因（数字键 1–6）</div>
          <div class="reasons">
            <button v-for="(r, i) in REASONS" :key="r" class="chip" :class="{ on: reason === r }" @click="reason = r" :data-test="`reason-${r}`">
              <kbd>{{ i + 1 }}</kbd>{{ DISCARD_REASON_LABEL[r] }}
            </button>
          </div>
          <input class="input" v-model="note" :placeholder="reason === 'other' ? '备注（必填）' : '备注（可选）'" style="margin-top: 8px" />
        </section>

        <div class="bar-actions" v-if="canEdit && current.verdict === 'pending'">
          <template v-if="mode === 'view'">
            <button class="btn danger" @click="mode = 'discard'" data-test="discard"><Trash2 :size="14" />废弃 <kbd>D</kbd></button>
            <button class="btn" @click="mode = 'edit'" data-test="edit"><Pencil :size="14" />修改 <kbd>E</kbd></button>
            <button class="btn primary" :disabled="busy" @click="submit('accepted')" data-test="accept">
              <Check :size="14" />{{ pointsChanged ? '通过（已改关联，记为修改）' : '通过' }} <kbd>A</kbd>
            </button>
          </template>
          <template v-else-if="mode === 'edit'">
            <button class="btn" @click="mode = 'view'"><X :size="14" />取消 <kbd>Esc</kbd></button>
            <button class="btn primary" :disabled="busy" @click="submit('edited')" data-test="save-edit"><Check :size="14" />修改后通过 <kbd>⌘↵</kbd></button>
          </template>
          <template v-else>
            <button class="btn" @click="mode = 'view'"><X :size="14" />取消 <kbd>Esc</kbd></button>
            <button class="btn danger-solid" :disabled="busy || !reason" @click="submit('discarded')" data-test="confirm-discard"><Trash2 :size="14" />确认废弃 <kbd>↵</kbd></button>
          </template>
        </div>
      </div>

      <div class="card detail done" v-else-if="done">
        <CheckCircle2 :size="36" style="color: var(--pass)" />
        <h2>本批 {{ batch.drafts.length }} 条草稿已全部审核</h2>
        <p class="muted">下一步：在批次详情里运行入库用例，统计“生成即跑通率”；或回到覆盖矩阵，针对未覆盖的需求点补生成。</p>
        <div style="display: flex; gap: 8px; justify-content: center">
          <RouterLink class="btn primary" :to="`/workshop/batches/${batch.id}`">查看批次度量</RouterLink>
          <RouterLink class="btn" :to="`/workshop/requirements/${batch.requirementId}?tab=coverage`">覆盖矩阵</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page.wide { max-width: 1440px; }
kbd { font-family: var(--mono); font-size: 11px; padding: 0 5px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 4px; background: #fff; color: var(--text-2); line-height: 16px; }
.btn kbd { margin-left: 2px; opacity: .8; }
.btn.primary kbd, .btn.danger-solid kbd { background: rgba(255, 255, 255, .15); color: #fff; border-color: rgba(255, 255, 255, .35); }
.prog { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.prog .bar { width: 140px; height: 6px; background: #eef1f6; border-radius: 3px; overflow: hidden; }
.prog .bar i { display: block; height: 100%; background: var(--pass); }
.bench { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: start; }
.queue { position: sticky; top: 72px; max-height: calc(100vh - 92px); overflow: auto; }
.queue-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 12.5px; font-weight: 500; position: sticky; top: 0; background: #fff; z-index: 1; }
.queue-head label { font-weight: 400; display: flex; gap: 4px; align-items: center; cursor: pointer; }
.qi { display: block; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid #eef1f5; border-left: 3px solid transparent; padding: 10px 14px 10px 11px; cursor: pointer; font: inherit; color: inherit; }
.qi:hover { background: #f8faff; }
.qi.sel { background: var(--brand-soft); border-left-color: var(--brand); }
.qi.accepted, .qi.edited, .qi.discarded { opacity: .65; }
.qi-1 { display: flex; gap: 8px; align-items: center; }
.qi-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.qi-2 { display: flex; gap: 8px; align-items: center; margin-top: 4px; font-size: 11.5px; }
.conf { font-family: var(--mono); font-size: 11px; padding: 1px 5px; border-radius: 4px; background: #eef1f6; color: var(--muted); flex: none; }
.conf.low { background: var(--fail-soft); color: var(--fail); }
.conf.mid { background: var(--skip-soft); color: var(--skip); }
.conf.high { background: var(--pass-soft); color: var(--pass); }
.detail { min-height: 420px; }
.d-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.d-head h2 { margin: 0; font-size: 16px; }
.d-head .nav { margin-left: auto; display: flex; gap: 2px; }
section { margin-bottom: 16px; }
.sec-title { font-size: 12px; font-weight: 600; color: var(--text-2); margin-bottom: 6px; }
.sec-title .muted { font-weight: 400; }
.pts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.pt { border: 1px solid var(--border-strong); background: #fff; border-radius: 6px; padding: 4px 8px; font: inherit; font-size: 12.5px; color: var(--muted); cursor: pointer; text-align: left; }
.pt.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
.pt:disabled { cursor: default; }
.excerpt { font-size: 12.5px; color: var(--text-2); background: #f7f9fc; border-left: 3px solid #cdd6e4; padding: 4px 8px; margin-top: 4px; border-radius: 0 4px 4px 0; }
.desc { font-size: 13px; color: var(--text-2); }
.steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
.steps li { font-size: 13.5px; }
.steps li .tag { margin-right: 8px; }
.steps.orig li { color: var(--muted); }
.discard { background: #fffaf9; border: 1px solid #f6d2cb; border-radius: 8px; padding: 12px; }
.reasons { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 15px; border: 1px solid var(--border-strong); background: #fff; font: inherit; font-size: 12.5px; cursor: pointer; }
.chip.on { border-color: var(--fail); background: var(--fail-soft); color: var(--fail); }
.bar-actions { display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid var(--border); padding-top: 14px; position: sticky; bottom: 0; background: #fff; }
.done { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; }
@media (max-width: 1000px) { .bench { grid-template-columns: 1fr; } .queue { position: static; max-height: 260px; } }
</style>
