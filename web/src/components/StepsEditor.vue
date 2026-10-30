<script setup lang="ts">
import { ref } from 'vue'
import { Code2, Copy, Globe, GripVertical, MessageSquareText, ShieldCheck, Sparkles, Trash2, Wand2 } from 'lucide-vue-next'
import CodeEditor from './CodeEditor.vue'
import { STEP_TYPE_LABEL, type Step, type StepType } from '../../../shared/types'

const steps = defineModel<Step[]>({ required: true })
const types = Object.entries(STEP_TYPE_LABEL) as [StepType, string][]

const placeholders: Record<StepType, string> = {
  ai_action: '例如：在用户名输入框输入 demo，然后点击登录按钮',
  ai_assert: '例如：页面顶部显示“欢迎你，demo”',
  ai_query: '例如：string[]，列表中所有待办事项的文字',
  code: "await page.click('[data-test=submit]')\nawait expect(page.locator('h1')).toContainText('欢迎')",
  api: 'method / url / headers / json / expect / extract',
}

const API_TEMPLATE = `method: POST
url: "{{DEMO_API}}/login"
json: { username: demo, password: demo123 }
expect:
  status: 200
  maxMs: 500
  json:
    token: { type: string }
extract:
  token: token   # 后续步骤用 {{token}} 引用`

const ADDERS: { type: StepType; label: string; icon: unknown }[] = [
  { type: 'ai_action', label: 'AI 操作', icon: Sparkles },
  { type: 'ai_assert', label: 'AI 断言', icon: ShieldCheck },
  { type: 'ai_query', label: 'AI 提取', icon: MessageSquareText },
  { type: 'code', label: '代码步骤', icon: Code2 },
  { type: 'api', label: '接口步骤', icon: Globe },
]
const testIdOf: Partial<Record<StepType, string>> = { ai_action: 'add-ai-step', code: 'add-code-step', api: 'add-api-step' }

function add(type: StepType) {
  steps.value.push({ type, content: type === 'api' ? API_TEMPLATE : '' })
}
function duplicate(i: number) {
  steps.value.splice(i + 1, 0, JSON.parse(JSON.stringify(steps.value[i])))
}
function remove(i: number) {
  steps.value.splice(i, 1)
}
function toggleFallback(s: Step) {
  s.fallback = s.fallback ? null : { type: 'ai_assert', content: '' }
}
function changeType(s: Step, t: StepType) {
  if (t === 'api' && !s.content.trim()) s.content = API_TEMPLATE
  if (t !== 'code') s.fallback = null
  s.type = t
}

// 拖拽排序（原生 HTML5 拖放，只允许从把手开始拖）
const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)
const armed = ref<number | null>(null)
function onDrop(i: number) {
  const from = dragFrom.value
  if (from !== null && from !== i) {
    const [moved] = steps.value.splice(from, 1)
    steps.value.splice(i, 0, moved)
  }
  dragFrom.value = dragOver.value = armed.value = null
}
</script>

<template>
  <div class="card steps-card">
    <h2>步骤 <span class="muted num" style="font-weight: 400">（{{ steps.length }}）</span></h2>
    <div
      v-for="(s, i) in steps"
      :key="i"
      class="step"
      :class="[s.type, { over: dragOver === i && dragFrom !== i, dragging: dragFrom === i }]"
      :draggable="armed === i"
      @dragstart="dragFrom = i"
      @dragover.prevent="dragOver = i"
      @dragleave="dragOver = dragOver === i ? null : dragOver"
      @drop.prevent="onDrop(i)"
      @dragend="dragFrom = dragOver = armed = null"
      data-test="step-row"
    >
      <div class="rail">
        <span class="grip" title="拖动排序" @mousedown="armed = i" @mouseup="armed = null"><GripVertical :size="15" /></span>
        <span class="idx num">{{ i + 1 }}</span>
      </div>
      <div class="body">
        <div class="head">
          <select class="type-select" :value="s.type" @change="changeType(s, ($event.target as HTMLSelectElement).value as StepType)" data-test="step-type" aria-label="步骤类型">
            <option v-for="[v, label] in types" :key="v" :value="v">{{ label }}</option>
          </select>
          <div class="tools">
            <button type="button" class="icon-btn" @click="duplicate(i)" title="复制此步"><Copy :size="14" /></button>
            <button type="button" class="icon-btn danger" @click="remove(i)" title="删除此步" data-test="step-remove"><Trash2 :size="14" /></button>
          </div>
        </div>
        <CodeEditor v-if="s.type === 'code'" v-model="s.content" lang="javascript" :placeholder="placeholders.code" test-id="step-content" :min-lines="3" />
        <CodeEditor v-else-if="s.type === 'api'" v-model="s.content" lang="yaml" :placeholder="placeholders.api" test-id="step-content" :min-lines="6" />
        <textarea v-else class="textarea nl" v-model="s.content" rows="2" :placeholder="placeholders[s.type]" data-test="step-content"></textarea>

        <div v-if="s.type === 'code'" class="fallback">
          <label class="toggle"><input type="checkbox" :checked="!!s.fallback" @change="toggleFallback(s)" data-test="fallback-toggle" /><Wand2 :size="13" /> 选择器失效时 AI 兜底</label>
          <template v-if="s.fallback">
            <select class="select" v-model="s.fallback.type" style="width: 104px">
              <option value="ai_action">AI 操作</option>
              <option value="ai_assert">AI 断言</option>
            </select>
            <input class="input" v-model="s.fallback.content" data-test="fallback-content" placeholder="用自然语言描述这一步，例如：页面标题显示“欢迎你，demo”" />
          </template>
        </div>
      </div>
    </div>

    <div class="adders">
      <span class="muted" style="font-size: 12px">添加步骤</span>
      <button v-for="a in ADDERS" :key="a.type" type="button" class="btn sm" :class="`add-${a.type}`" @click="add(a.type)" :data-test="testIdOf[a.type]">
        <component :is="a.icon" :size="13" />{{ a.label }}
      </button>
    </div>
    <details class="syntax">
      <summary>步骤写法说明</summary>
      <ul>
        <li><b>AI 操作 / 断言 / 提取</b>：用自然语言描述看得见的界面元素，由视觉模型（Midscene）执行；未配置模型时跳过。提取步骤的结果存为 <code>vars.step3</code>。</li>
        <li><b>代码步骤</b>：Playwright 代码，可用 <code>page</code>、<code>expect</code>、<code>vars</code>（环境变量、接口提取的变量）。可设置 AI 兜底：代码失败时改由视觉模型按描述执行，并标记“已自愈”。</li>
        <li><b>接口步骤</b>：YAML 描述 <code>method / url / headers / query / json</code>；<code>expect</code> 支持 <code>status</code>、<code>maxMs</code>、<code>headers</code>、<code>bodyContains</code>，以及 <code>json</code> 字段的 <code>eq / exists / contains / len / gt / lt / type</code>；<code>extract</code> 提取变量供后续步骤用 <code v-pre>{{名称}}</code> 引用。</li>
        <li><b>变量</b>：<code v-pre>{{DEMO}}</code>、<code v-pre>{{DEMO_API}}</code>、<code v-pre>{{BASE_URL}}</code>、环境变量，以及动态变量 <code v-pre>{{$timestamp}}</code> / <code v-pre>{{$randomInt}}</code> / <code v-pre>{{$uuid}}</code>。</li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.step { display: flex; gap: 10px; padding: 12px 10px 12px 4px; margin: 0 -10px 0 -4px; border-radius: 8px; border-top: 1px solid #eef1f5; transition: background .12s; }
.step:first-of-type { border-top: 0; }
.step.over { background: var(--brand-soft); box-shadow: inset 0 2px 0 var(--brand); }
.step.dragging { opacity: .45; }
.rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 3px; }
.grip { color: #b2bac8; cursor: grab; display: grid; place-items: center; height: 20px; }
.grip:hover { color: var(--muted); }
.idx { width: 24px; height: 24px; border-radius: 50%; background: var(--brand-soft); color: var(--brand); display: grid; place-items: center; font-size: 12px; font-weight: 600; }
.step.code .idx { background: #eef1f6; color: #3d4a5c; }
.step.api .idx { background: #e4f4f6; color: #0e6a78; }
.step[class*='ai_'] .idx { background: #f1ecfd; color: #5b3cc4; }
.body { flex: 1; min-width: 0; }
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.type-select { height: 28px; border: 1px solid var(--border-strong); border-radius: 6px; padding: 0 8px; font: inherit; font-size: 12.5px; font-weight: 500; background: #fff; cursor: pointer; }
.tools { margin-left: auto; display: flex; gap: 2px; opacity: .55; transition: opacity .12s; }
.step:hover .tools { opacity: 1; }
.nl { min-height: 56px; font-size: 13.5px; }
.fallback { display: flex; gap: 8px; align-items: center; margin-top: 8px; font-size: 12.5px; }
.fallback .toggle { display: flex; gap: 4px; align-items: center; white-space: nowrap; color: var(--muted); cursor: pointer; }
.fallback .input, .fallback .select { height: 28px; padding: 2px 8px; font-size: 12.5px; }
.adders { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-strong); }
.syntax { margin-top: 12px; font-size: 12.5px; color: var(--text-2); }
.syntax summary { cursor: pointer; color: var(--muted); }
.syntax ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.8; }
</style>
