<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import ApiExchange from '../components/ApiExchange.vue'
import { MUTATION_LABEL, STEP_TYPE_LABEL, type RunDetail } from '../../../shared/types'
import { RUN_STATUS_LABEL, STEP_STATUS_LABEL, formatDuration, formatTime } from '../format'

const props = defineProps<{ id: string }>()
const router = useRouter()
const run = ref<RunDetail | null>(null)
const error = ref('')
const preview = ref<string | null>(null)
let timer: number | undefined

const active = computed(() => run.value && ['queued', 'running'].includes(run.value.status))
const executed = computed(() => (run.value ? run.value.passed + run.value.healed + run.value.failed : 0))
const passRate = computed(() =>
  run.value && executed.value ? `${Math.round(((run.value.passed + run.value.healed) / executed.value) * 100)}%` : '—',
)

async function load() {
  try {
    run.value = await api.getRun(Number(props.id))
    error.value = ''
  } catch (e: any) {
    error.value = e.message
  }
  clearTimeout(timer)
  if (active.value) timer = window.setTimeout(load, 800)
}

async function rerun() {
  if (!run.value) return
  const { runId } = await api.runCaseIn(run.value.caseId, run.value.env?.id ?? null)
  router.push(`/runs/${runId}`)
}

watch(() => props.id, load, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="page" v-if="run">
    <div class="page-head">
      <div>
        <h1>
          运行 <span class="num">#{{ run.id }}</span> · {{ run.caseName }}
          <span class="tag" :class="run.status" data-test="run-status" style="margin-left: 8px; vertical-align: 3px">{{ RUN_STATUS_LABEL[run.status] }}</span>
          <span v-if="run.mutation && run.mutation !== 'none'" class="tag skipped" data-test="run-mutation" style="margin-left: 6px; vertical-align: 3px">变更注入：{{ MUTATION_LABEL[run.mutation] }}</span>
        </h1>
        <div class="sub num">{{ run.url || "纯接口用例（未打开浏览器）" }} · 环境：<span data-test="run-env">{{ run.env?.name ?? '默认' }}</span> · 开始于 {{ formatTime(run.startedAt) }}</div>
      </div>
      <div style="display: flex; gap: 8px">
        <a v-if="run.midsceneReport" class="btn" :href="`/midscene/${run.midsceneReport}`" target="_blank">Midscene 回放报告</a>
        <RouterLink class="btn" :to="`/cases/${run.caseId}/edit`">编辑用例</RouterLink>
        <button class="btn primary" @click="rerun" :disabled="!!active" data-test="rerun">再次运行</button>
      </div>
    </div>

    <div v-if="run.error" class="alert error">{{ run.error }}</div>
    <div v-if="run.healed && !active" class="alert info" data-test="healed-banner">
      {{ run.healed }} 个代码步骤失败后由 AI 兜底通过（自愈）。这通常说明选择器已经失效，建议按下方提示更新用例。
    </div>
    <div v-if="run.skipped && !active" class="alert warn">
      {{ run.skipped }} 个自然语言步骤因未配置模型被跳过。在 <code>.env</code> 中填写 MIDSCENE_MODEL_* 后重启平台即可执行。
    </div>

    <div class="metrics">
      <div class="metric"><div class="label">步骤通过率</div><div class="value num" data-test="pass-rate">{{ passRate }}</div><div class="foot num">{{ run.passed }} / {{ executed }} 已执行步骤</div></div>
      <div class="metric"><div class="label">总耗时</div><div class="value num">{{ active ? '…' : formatDuration(run.durationMs) }}</div><div class="foot num">共 {{ run.total }} 步</div></div>
      <div class="metric"><div class="label">失败 / 跳过</div><div class="value num"><span :class="{ red: run.failed }">{{ run.failed }}</span> / {{ run.skipped }}</div><div class="foot">失败后剩余步骤不再执行</div></div>
      <div class="metric"><div class="label">模型调用</div><div class="value num" data-test="ai-calls">{{ run.aiCalls }}</div><div class="foot num">{{ run.tokens.toLocaleString() }} tokens</div></div>
    </div>

    <div class="card flush">
      <div v-for="s in run.steps" :key="s.index" class="step" :class="s.status" data-test="run-step">
        <div class="idx num">{{ s.index + 1 }}</div>
        <div class="main">
          <div class="line">
            <span class="tag" :class="s.type === 'code' ? 'code' : s.type === 'api' ? 'api' : 'ai'">{{ STEP_TYPE_LABEL[s.type] }}</span>
            <span class="tag" :class="s.status" data-test="step-status">
              <span v-if="s.status === 'running'" class="spin"></span>{{ STEP_STATUS_LABEL[s.status] }}
            </span>
            <span class="meta num" v-if="s.durationMs">{{ formatDuration(s.durationMs) }}</span>
            <span class="meta num" v-if="s.aiCalls">模型 {{ s.aiCalls }} 次 · {{ s.tokens.toLocaleString() }} tokens</span>
          </div>
          <pre v-if="s.type === 'code' || s.type === 'api'" class="code content">{{ s.content }}</pre>
          <div v-else class="content">{{ s.content }}</div>
          <div v-if="s.fallback" class="muted" style="font-size: 12px; margin-top: 4px">AI 兜底（{{ s.fallback.type === 'ai_assert' ? '断言' : '操作' }}）：{{ s.fallback.content }}</div>
          <div v-if="s.error && s.status === 'healed'" class="heal"><pre class="code">{{ s.error }}</pre></div>
          <div v-else-if="s.error && s.status !== 'skipped'" class="err"><pre class="code">{{ s.error }}</pre></div>
          <div v-else-if="s.status === 'skipped'" class="muted" style="font-size: 12px">{{ s.error }}</div>
          <ApiExchange v-if="s.type === 'api' && s.output" :result="s.output as any" />
          <div v-else-if="s.output !== undefined" class="out"><span class="muted">提取结果：</span><code class="num">{{ JSON.stringify(s.output) }}</code></div>
          <img v-if="s.screenshot && s.status === 'failed'" class="shot big" :src="`/artifacts/${s.screenshot}`" @click="preview = s.screenshot" data-test="fail-shot" />
        </div>
        <img v-if="s.screenshot && s.status !== 'failed'" class="shot" :src="`/artifacts/${s.screenshot}`" @click="preview = s.screenshot" />
      </div>
    </div>

    <div v-if="preview" class="lightbox" @click="preview = null"><img :src="`/artifacts/${preview}`" /></div>
  </div>
  <div class="page" v-else-if="error"><div class="alert error">{{ error }}</div></div>
</template>

<style scoped>
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.metric { background: #fff; border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.metric .label { color: var(--muted); font-size: 12px; }
.metric .value { font-size: 24px; font-weight: 600; margin: 2px 0; }
.metric .foot { color: var(--muted); font-size: 12px; }
.red { color: var(--fail); }
.step { display: flex; gap: 14px; padding: 14px 18px; border-bottom: 1px solid var(--border); border-left: 3px solid transparent; }
.step:last-child { border-bottom: 0; }
.step.failed { border-left-color: var(--fail); background: #fffafa; }
.step.running { border-left-color: var(--brand); }
.step.not_run, .step.pending { opacity: .55; }
.idx { width: 24px; height: 24px; border-radius: 50%; background: #eef1f6; display: grid; place-items: center; font-size: 12px; flex: none; }
.main { flex: 1; min-width: 0; }
.line { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.meta { color: var(--muted); font-size: 12px; }
.content { font-size: 13.5px; }
pre.content { background: #f7f9fc; border-radius: 6px; padding: 8px 10px; }
.err { margin-top: 8px; background: var(--fail-soft); color: var(--fail); border-radius: 6px; padding: 8px 10px; max-height: 220px; overflow: auto; }
.out { margin-top: 6px; font-size: 12.5px; }
.heal { margin-top: 8px; background: #e9f2ff; color: #1b4f91; border-radius: 6px; padding: 8px 10px; max-height: 220px; overflow: auto; }
.step.healed { border-left-color: #1b5fb4; }
.shot { width: 160px; height: 100px; object-fit: cover; object-position: top; border: 1px solid var(--border); border-radius: 6px; cursor: zoom-in; flex: none; }
.shot.big { display: block; width: 100%; max-width: 640px; height: auto; margin-top: 10px; }
.spin { width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; display: inline-block; margin-right: 5px; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.lightbox { position: fixed; inset: 0; background: rgba(15, 30, 61, .75); display: grid; place-items: center; z-index: 10; cursor: zoom-out; }
.lightbox img { max-width: 92vw; max-height: 92vh; border-radius: 6px; }
</style>
