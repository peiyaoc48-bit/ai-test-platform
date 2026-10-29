<script setup lang="ts">
import { STEP_TYPE_LABEL, type Step, type StepType } from '../../../shared/types'

const steps = defineModel<Step[]>({ required: true })
const types = Object.entries(STEP_TYPE_LABEL) as [StepType, string][]

const placeholders: Record<StepType, string> = {
  ai_action: '例如：在用户名输入框输入 demo，然后点击登录按钮',
  ai_assert: '例如：页面顶部显示“欢迎你，demo”',
  ai_query: '例如：string[]，列表中所有待办事项的文字',
  code: "例如：await page.click('[data-test=submit]')\nawait expect(page.locator('h1')).toContainText('欢迎')",
}

function add(type: StepType) {
  steps.value.push({ type, content: '' })
}
function move(i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= steps.value.length) return
  const arr = steps.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}
function remove(i: number) {
  steps.value.splice(i, 1)
}
</script>

<template>
  <div class="card">
    <h2>步骤 <span class="muted num" style="font-weight: 400">（{{ steps.length }}）</span></h2>
    <div v-for="(s, i) in steps" :key="i" class="step" data-test="step-row">
      <div class="idx num">{{ i + 1 }}</div>
      <div class="body">
        <select class="select" v-model="s.type" data-test="step-type" style="width: 160px; margin-bottom: 6px">
          <option v-for="[v, label] in types" :key="v" :value="v">{{ label }}</option>
        </select>
        <textarea
          class="textarea"
          :class="{ code: s.type === 'code' }"
          v-model="s.content"
          :rows="s.type === 'code' ? 4 : 2"
          :placeholder="placeholders[s.type]"
          data-test="step-content"
        ></textarea>
      </div>
      <div class="ops">
        <button type="button" class="btn sm" @click="move(i, -1)" :disabled="i === 0" title="上移">↑</button>
        <button type="button" class="btn sm" @click="move(i, 1)" :disabled="i === steps.length - 1" title="下移">↓</button>
        <button type="button" class="btn sm danger" @click="remove(i)" title="删除" data-test="step-remove">✕</button>
      </div>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 4px">
      <button type="button" class="btn sm" @click="add('ai_action')" data-test="add-ai-step">+ 自然语言步骤</button>
      <button type="button" class="btn sm" @click="add('ai_assert')">+ AI 断言</button>
      <button type="button" class="btn sm" @click="add('code')" data-test="add-code-step">+ 代码步骤</button>
    </div>
    <div class="hint" style="margin-top: 10px">
      代码步骤可使用 <code>page</code>（Playwright Page）、<code>expect</code>（@playwright/test）和 <code>vars</code>（AI 提取步骤的结果，按步骤序号存为 <code>vars.step3</code>）。
    </div>
  </div>
</template>

<style scoped>
.step { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border); }
.step:first-of-type { border-top: 0; padding-top: 0; }
.idx { width: 24px; height: 24px; border-radius: 50%; background: var(--brand-soft); color: var(--brand); display: grid; place-items: center; font-size: 12px; flex: none; margin-top: 4px; }
.body { flex: 1; min-width: 0; }
.ops { display: flex; flex-direction: column; gap: 4px; }
</style>
