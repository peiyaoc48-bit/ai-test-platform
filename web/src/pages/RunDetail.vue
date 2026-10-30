<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, Info, Pencil, RotateCw, Sparkles, TriangleAlert, Zap } from 'lucide-vue-next'
import { api } from '../api'
import ApiExchange from '../components/ApiExchange.vue'
import StatusBadge from '../ui/StatusBadge.vue'
import { MUTATION_LABEL, STEP_TYPE_LABEL, type RunDetail, type StepResult } from '../../../shared/types'
import { formatDuration, formatTime } from '../format'

const props = defineProps<{ id: string }>()
const router = useRouter()
const run = ref<RunDetail | null>(null)
const error = ref('')
const preview = ref<string | null>(null)
const selected = ref(0)
const userPicked = ref(false)
let timer: number | undefined

const active = computed(() => run.value && ['queued', 'running'].includes(run.value.status))
const executed = computed(() => (run.value ? run.value.passed + run.value.healed + run.value.failed : 0))
const passRate = computed(() =>
  run.value && executed.value ? `${Math.round(((run.value.passed + run.value.healed) / executed.value) * 100)}%` : '—',
)
const maxMs = computed(() => Math.max(1, ...(run.value?.steps.map((s) => s.durationMs) ?? [1])))
const step = computed<StepResult | undefined>(() => run.value?.steps[selected.value])
const title = (s: StepResult) => s.content.split('\n').find((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('//'))?.trim() ?? s.content
const typeClass = (t: string) => (t === 'code' ? 'code' : t === 'api' ? 'api' : 'ai')

/** 没手动选过时自动聚焦：执行中的步骤 > 第一个失败 > 第一个自愈 > 第一步 */
function autoSelect() {
  if (!run.value || userPicked.value) return
  const s = run.value.steps
  const i = [s.findIndex((x) => x.status === 'running'), s.findIndex((x) => x.status === 'failed'), s.findIndex((x) => x.status === 'healed')].find((n) => n >= 0)
  selected.value = i ?? 0
}

async function load() {
  try {
    run.value = await api.getRun(Number(props.id))
    error.value = ''
    autoSelect()
  } catch (e: any) {
    error.value = e.message
  }
  clearTimeout(timer)
  if (active.value) timer = window.setTimeout(load, 800)
}
function pick(i: number) {
  userPicked.value = true
  selected.value = i
}
async function rerun() {
  if (!run.value) return
  const { runId } = await api.runCaseIn(run.value.caseId, run.value.env?.id ?? null)
  router.push(`/runs/${runId}`)
}
const onKey = (e: KeyboardEvent) => {
  if (!run.value || (e.target as HTMLElement)?.tagName === 'INPUT') return
  if (e.key === 'ArrowDown' || e.key === 'j') pick(Math.min(selected.value + 1, run.value.steps.length - 1))
  else if (e.key === 'ArrowUp' || e.key === 'k') pick(Math.max(selected.value - 1, 0))
  else if (e.key === 'Escape') preview.value = null
  else return
  e.preventDefault()
}
watch(() => props.id, () => { userPicked.value = false; load() }, { immediate: true })
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => { clearTimeout(timer); window.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="page wide" v-if="run">
    <div class="page-head">
      <div style="min-width: 0">
        <h1>
          <span class="muted num" style="font-weight: 500">#{{ run.id }}</span>
          <span class="ellipsis">{{ run.caseName }}</span>
          <span data-test="run-status"><StatusBadge :status="run.status" /></span>
          <span v-if="run.mutation && run.mutation !== 'none'" class="tag skipped" data-test="run-mutation">变更注入：{{ MUTATION_LABEL[run.mutation] }}</span>
        </h1>
        <div class="meta">
          <span>环境 <b data-test="run-env">{{ run.env?.name ?? '默认' }}</b></span>
          <span class="num">{{ run.url || '纯接口用例（未打开浏览器）' }}</span>
          <span class="num">开始于 {{ formatTime(run.startedAt) }}</span>
          <RouterLink v-if="run.batchId" :to="`/batches/${run.batchId}`">所属批次 #{{ run.batchId }}</RouterLink>
        </div>
      </div>
      <div class="head-actions">
        <a v-if="run.midsceneReport" class="btn" :href="`/midscene/${run.midsceneReport}`" target="_blank"><ExternalLink :size="14" />Midscene 回放</a>
        <RouterLink class="btn" :to="`/cases/${run.caseId}/edit`"><Pencil :size="14" />编辑用例</RouterLink>
        <button class="btn primary" @click="rerun" :disabled="!!active" data-test="rerun"><RotateCw :size="14" />再次运行</button>
      </div>
    </div>

    <div v-if="run.error" class="alert error"><AlertCircle :size="16" />{{ run.error }}</div>
    <div v-if="run.healed && !active" class="alert info" data-test="healed-banner">
      <Sparkles :size="16" />{{ run.healed }} 个代码步骤失败后由 AI 兜底通过（自愈）。这通常说明选择器已经失效，建议更新用例。
    </div>
    <div v-if="run.skipped && !active" class="alert warn">
      <TriangleAlert :size="16" />{{ run.skipped }} 个自然语言步骤因未配置模型被跳过。在 .env 中填写 MIDSCENE_MODEL_* 后重启平台即可执行。
    </div>

    <div class="summary card">
      <div><div class="k">步骤通过率</div><div class="v num" data-test="pass-rate">{{ passRate }}</div><div class="f num">{{ run.passed + run.healed }} / {{ executed }} 已执行</div></div>
      <div><div class="k">总耗时</div><div class="v num">{{ active ? '…' : formatDuration(run.durationMs) }}</div><div class="f num">共 {{ run.total }} 步</div></div>
      <div><div class="k">失败 / 跳过 / 自愈</div><div class="v num"><span :class="{ red: run.failed }">{{ run.failed }}</span> / {{ run.skipped }} / {{ run.healed }}</div><div class="f">{{ run.continueOnFailure ? '失败后继续执行' : '失败后停止' }}</div></div>
      <div><div class="k"><Zap :size="12" /> 模型调用</div><div class="v num" data-test="ai-calls">{{ run.aiCalls }}</div><div class="f num">{{ run.tokens.toLocaleString() }} tokens</div></div>
    </div>

    <div class="trace">
      <!-- 左：步骤时间线 -->
      <div class="card flush steps" role="listbox" aria-label="步骤">
        <div class="card-head"><h2>步骤</h2><span class="muted" style="font-size: 11.5px">↑ ↓ 切换</span></div>
        <button
          v-for="(s, i) in run.steps"
          :key="i"
          class="step"
          :class="[s.status, { sel: selected === i }]"
          role="option"
          :aria-selected="selected === i"
          @click="pick(i)"
          data-test="run-step"
        >
          <span class="idx num">{{ i + 1 }}</span>
          <span class="body">
            <span class="line1">
              <span class="tag" :class="typeClass(s.type)">{{ STEP_TYPE_LABEL[s.type] }}</span>
              <span data-test="step-status"><StatusBadge :status="s.status" size="sm" /></span>
              <span class="ms num" v-if="s.durationMs">{{ formatDuration(s.durationMs) }}</span>
            </span>
            <span class="line2">{{ title(s) }}</span>
            <span class="bar"><i :style="{ width: `${(s.durationMs / maxMs) * 100}%` }"></i></span>
          </span>
        </button>
      </div>

      <!-- 右：选中步骤详情 -->
      <div class="card detail" v-if="step">
        <div class="detail-head">
          <h2>
            第 {{ selected + 1 }} 步 · {{ STEP_TYPE_LABEL[step.type] }}
            <StatusBadge :status="step.status" size="sm" />
          </h2>
          <div class="muted num" style="font-size: 12px">
            <span v-if="step.durationMs">{{ formatDuration(step.durationMs) }}</span>
            <span v-if="step.aiCalls"> · 模型 {{ step.aiCalls }} 次 · {{ step.tokens.toLocaleString() }} tokens</span>
          </div>
          <div class="nav">
            <button class="icon-btn" :disabled="selected === 0" @click="pick(selected - 1)" title="上一步"><ChevronUp :size="16" /></button>
            <button class="icon-btn" :disabled="selected === run.steps.length - 1" @click="pick(selected + 1)" title="下一步"><ChevronDown :size="16" /></button>
          </div>
        </div>

        <pre v-if="step.type === 'code' || step.type === 'api'" class="code src">{{ step.content }}</pre>
        <div v-else class="nl">{{ step.content }}</div>
        <div v-if="step.fallback" class="fallback"><Sparkles :size="13" />AI 兜底（{{ step.fallback.type === 'ai_assert' ? '断言' : '操作' }}）：{{ step.fallback.content }}</div>

        <div v-if="step.error && step.status === 'healed'" class="box heal"><div class="box-title">已自愈</div><pre class="code">{{ step.error }}</pre></div>
        <div v-else-if="step.error && step.status !== 'skipped'" class="box err"><div class="box-title">错误</div><pre class="code">{{ step.error }}</pre></div>
        <div v-else-if="step.status === 'skipped'" class="box muted-box"><Info :size="14" />{{ step.error }}</div>
        <div v-else-if="step.status === 'not_run'" class="box muted-box"><Info :size="14" />前面的步骤失败，本步未执行</div>

        <ApiExchange v-if="step.type === 'api' && step.output" :result="step.output as any" />
        <div v-else-if="step.output !== undefined" class="box"><div class="box-title">提取结果</div><code class="num">{{ JSON.stringify(step.output) }}</code></div>

        <figure v-if="step.screenshot" class="shot">
          <img :src="`/artifacts/${step.screenshot}`" @click="preview = step.screenshot" :data-test="step.status === 'failed' ? 'fail-shot' : 'step-shot'" alt="步骤截图" />
          <figcaption class="muted">步骤结束时的页面截图（点击放大）</figcaption>
        </figure>
      </div>
    </div>

    <div v-if="preview" class="lightbox" @click="preview = null"><img :src="`/artifacts/${preview}`" alt="截图大图" /></div>
  </div>
  <div class="page" v-else-if="error"><div class="alert error"><AlertCircle :size="16" />{{ error }}</div></div>
  <div class="page" v-else><div class="skeleton" style="width: 40%; height: 24px"></div></div>
</template>

<style scoped>
.page.wide { max-width: 1440px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 640px; }
.meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); font-size: 12.5px; margin-top: 6px; }
.meta b { color: var(--text-2); font-weight: 500; }
.summary { display: grid; grid-template-columns: repeat(4, 1fr); padding: 0; }
.summary > div { padding: 14px 18px; border-right: 1px solid var(--border); }
.summary > div:last-child { border-right: 0; }
.summary .k { color: var(--muted); font-size: 12px; display: flex; align-items: center; gap: 4px; }
.summary .v { font-size: 22px; font-weight: 600; margin: 2px 0; }
.summary .f { color: var(--muted); font-size: 12px; }
.red { color: var(--fail); }

.trace { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 16px; align-items: start; }
.steps { position: sticky; top: 72px; max-height: calc(100vh - 92px); overflow: auto; }
.step { display: flex; gap: 10px; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid #eef1f5; border-left: 3px solid transparent; padding: 10px 14px 10px 11px; cursor: pointer; font: inherit; color: inherit; }
.step:hover { background: #f8faff; }
.step.sel { background: var(--brand-soft); border-left-color: var(--brand); }
.step.failed { border-left-color: var(--fail); }
.step.failed.sel { background: #fff4f2; }
.step.healed { border-left-color: #1b5fb4; }
.step.not_run, .step.pending { opacity: .6; }
.idx { width: 22px; height: 22px; border-radius: 50%; background: #eef1f6; display: grid; place-items: center; font-size: 11px; flex: none; margin-top: 1px; }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.line1 { display: flex; gap: 6px; align-items: center; }
.line1 .ms { margin-left: auto; color: var(--muted); font-size: 11.5px; }
.line2 { font-size: 12.5px; color: var(--text-2); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { height: 3px; background: #eef1f6; border-radius: 2px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #9db5ea; border-radius: 2px; min-width: 2px; }
.step.failed .bar i { background: #e8907f; }

.detail { min-height: 360px; }
.detail-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.detail-head h2 { margin: 0; }
.detail-head .nav { margin-left: auto; display: flex; gap: 2px; }
.src { background: #f7f9fc; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; }
.nl { font-size: 14px; padding: 10px 12px; background: #faf8ff; border: 1px solid #ebe4fb; border-radius: 8px; }
.fallback { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12.5px; color: #1b5fb4; }
.box { margin-top: 12px; border-radius: 8px; padding: 10px 12px; border: 1px solid var(--border); background: #fafbfd; font-size: 12.5px; max-height: 280px; overflow: auto; }
.box-title { font-size: 11.5px; font-weight: 600; margin-bottom: 4px; letter-spacing: .3px; }
.box.err { background: var(--fail-soft); border-color: #f6d2cb; color: #9b2a17; }
.box.heal { background: #eef5ff; border-color: #cfe0fb; color: #1b4f91; }
.muted-box { display: flex; gap: 6px; align-items: center; color: var(--muted); }
.shot { margin: 14px 0 0; }
.shot img { display: block; width: 100%; border: 1px solid var(--border); border-radius: 8px; cursor: zoom-in; }
.shot figcaption { font-size: 12px; margin-top: 6px; }
.lightbox { position: fixed; inset: 0; background: rgba(15, 30, 61, .78); display: grid; place-items: center; z-index: 30; cursor: zoom-out; }
.lightbox img { max-width: 94vw; max-height: 94vh; border-radius: 6px; }
@media (max-width: 1100px) { .trace { grid-template-columns: 1fr; } .steps { position: static; max-height: none; } .summary { grid-template-columns: repeat(2, 1fr); } }
</style>
