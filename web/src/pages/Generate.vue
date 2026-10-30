<script setup lang="ts">
import { canEdit } from '../session'
import { AlertCircle, Loader2, Sparkles, TriangleAlert } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type GenerateResult } from '../api'
import { toast } from '../ui/feedback'
import StepsEditor from '../components/StepsEditor.vue'
import type { CaseInput, PlatformConfig } from '../../../shared/types'

const EXAMPLE = `小待办（TodoLite）登录与待办管理：
1. 用户在登录页输入用户名和密码后点击“登录”，账号正确时进入“我的待办”页，标题显示“欢迎你，<用户名>”。演示账号 demo / demo123。
2. 用户名或密码错误时，停留在登录页，并在登录按钮下方显示红色提示“用户名或密码错误”；任一项为空时提示“请输入用户名和密码”。
3. 待办页可以在输入框输入内容后点击“添加”新增待办；每条待办可勾选完成（完成后文字显示删除线）或点击“删除”移除。
4. 列表下方显示统计“共 N 项，已完成 M 项”。`

const router = useRouter()
const config = ref<PlatformConfig | null>(null)
const requirement = ref('')
const url = ref('{{DEMO}}/index.html')
const loading = ref(false)
const error = ref('')
const result = ref<GenerateResult | null>(null)
const drafts = ref<(CaseInput & { keep: boolean })[]>([])
const saving = ref(false)
const startedAt = ref(0)
const elapsed = ref(0)

onMounted(async () => (config.value = await api.config()))
const keepCount = computed(() => drafts.value.filter((d) => d.keep).length)

async function generate() {
  error.value = ''
  loading.value = true
  startedAt.value = Date.now()
  const tick = window.setInterval(() => (elapsed.value = Math.round((Date.now() - startedAt.value) / 1000)), 500)
  try {
    result.value = await api.generate(requirement.value, url.value)
    drafts.value = result.value.drafts.map((d) => ({ ...d, keep: true }))
  } catch (e: any) {
    error.value = e.message
  } finally {
    clearInterval(tick)
    loading.value = false
  }
}

async function save() {
  error.value = ''
  saving.value = true
  try {
    for (const d of drafts.value.filter((d) => d.keep)) {
      const { keep, ...input } = d
      await api.createCase(input)
    }
    toast(`已保存 ${keepCount.value} 条用例`)
    router.push('/cases')
  } catch (e: any) {
    error.value = `保存失败：${e.message}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>AI 生成用例</h1>
        <div class="sub">粘贴需求文本，由大模型生成自然语言步骤的用例草稿；草稿需人工审核、修改后才会保存。</div>
      </div>
    </div>

    <div v-if="!canEdit" class="alert warn"><TriangleAlert :size="16" /><div>演示站点为只读：AI 生成会消耗模型 token，登录后才能使用。</div></div>
    <div v-if="config && !config.modelConfigured" class="alert warn" data-test="no-model">
      <TriangleAlert :size="16" />
      <div>
        <strong>未配置大模型，暂不能生成。</strong>
        复制 <code>.env.example</code> 为 <code>.env</code>，填写 <code>MIDSCENE_MODEL_BASE_URL</code>、<code>MIDSCENE_MODEL_API_KEY</code>、<code>MIDSCENE_MODEL_NAME</code> 后重启平台（<code>npm run dev</code>）。
      </div>
    </div>
    <div v-if="error" class="alert error" data-test="gen-error"><AlertCircle :size="16" />{{ error }}</div>

    <div class="gen-layout">
      <div class="card">
        <div class="field">
          <label>需求描述 <button class="btn link" type="button" @click="requirement = EXAMPLE" data-test="fill-example">填入示例需求</button></label>
          <textarea class="textarea" v-model="requirement" rows="10" data-test="requirement" placeholder="粘贴 PRD 片段、用户故事或验收标准……"></textarea>
          <div class="hint num">{{ requirement.trim().length }} / 8000 字</div>
        </div>
        <div class="field">
          <label>目标 URL</label>
          <input class="input num" v-model="url" />
        </div>
        <div style="display: flex; align-items: center; gap: 10px">
          <button class="btn primary" @click="generate" :disabled="loading || !canEdit || !config?.modelConfigured || requirement.trim().length < 10" data-test="generate">
            <Loader2 v-if="loading" :size="14" class="spin" /><Sparkles v-else :size="14" />
            {{ loading ? `生成中…（${elapsed}s）` : '生成用例草稿' }}
          </button>
          <span class="muted" style="font-size: 12px" v-if="config?.genModelName">模型：{{ config.genModelName }}</span>
        </div>
      </div>
      <div class="card how">
        <h2>工作方式</h2>
        <ol>
          <li><b>粘贴需求</b>：PRD 片段、用户故事或验收标准都可以，写清楚期望出现的文案效果更好。</li>
          <li><b>生成草稿</b>：大模型按“主流程 + 异常 / 边界场景”生成 2～5 条用例，步骤为自然语言，至少包含一个具体的断言。</li>
          <li><b>人工审核</b>：逐条修改或取消勾选；需求里没有的账号和文案，模型会在描述里标注“需确认”。</li>
          <li><b>保存入库</b>：只保存勾选的草稿，保存时走与手工新建相同的校验。</li>
        </ol>
      </div>
    </div>

    <template v-if="drafts.length">
      <div class="page-head" style="margin-top: 8px">
        <div>
          <h1 style="font-size: 16px">草稿（{{ drafts.length }}）</h1>
          <div class="sub num" v-if="result">{{ result.model }} · {{ result.usage.totalTokens.toLocaleString() }} tokens · 取消勾选的草稿不会保存</div>
        </div>
        <button class="btn primary" @click="save" :disabled="!keepCount || saving" data-test="save-drafts">保存选中的 {{ keepCount }} 条用例</button>
      </div>
      <div v-for="(d, i) in drafts" :key="i" class="draft" :class="{ off: !d.keep }" data-test="draft">
        <div class="card" style="margin-bottom: 0">
          <label class="keep"><input type="checkbox" v-model="d.keep" /> 采纳</label>
          <div class="field"><label>用例名称</label><input class="input" v-model="d.name" /></div>
          <div class="field" style="margin-bottom: 0"><label>描述</label><input class="input" v-model="d.description" /></div>
        </div>
        <StepsEditor v-model="d.steps" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.draft { margin-bottom: 20px; border-left: 3px solid var(--brand); padding-left: 12px; }
.draft.off { opacity: .5; border-left-color: var(--border); }
.draft :deep(.card) { margin-bottom: 8px; }
.keep { float: right; font-size: 13px; display: flex; gap: 6px; align-items: center; cursor: pointer; }
.gen-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.how ol { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--text-2); line-height: 1.75; }
.how li { margin-bottom: 6px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1000px) { .gen-layout { grid-template-columns: 1fr; } }
</style>
