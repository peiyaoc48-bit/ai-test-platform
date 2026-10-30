<script setup lang="ts">
import { canEdit } from '../session'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Lightbulb, Play, Save } from 'lucide-vue-next'
import { api } from '../api'
import StepsEditor from '../components/StepsEditor.vue'
import { toast } from '../ui/feedback'
import type { CaseInput } from '../../../shared/types'

const props = defineProps<{ id?: string }>()
const router = useRouter()
const form = reactive<CaseInput>({
  name: '',
  description: '',
  url: '{{DEMO}}/index.html',
  steps: [{ type: 'ai_action', content: '' }],
})
const error = ref('')
const saving = ref(false)
// 编辑模式下等数据加载完再渲染表单，避免加载结果覆盖用户已输入的内容
const loaded = ref(!props.id)

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  if (!props.id) return
  const c = await api.getCase(Number(props.id))
  Object.assign(form, { name: c.name, description: c.description, url: c.url, steps: c.steps })
  loaded.value = true
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
// ⌘S / Ctrl+S 保存
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && canEdit.value) {
    e.preventDefault()
    void save()
  }
}

const counts = computed(() => ({
  ai: form.steps.filter((s) => s.type.startsWith('ai_')).length,
  code: form.steps.filter((s) => s.type === 'code').length,
  api: form.steps.filter((s) => s.type === 'api').length,
  fallback: form.steps.filter((s) => s.type === 'code' && s.fallback?.content.trim()).length,
}))

async function save(thenRun = false) {
  error.value = ''
  saving.value = true
  try {
    // 只有代码步骤保留 AI 兜底；描述为空视为不设置
    const body = {
      ...form,
      steps: form.steps.map(({ type, content, fallback }) =>
        type === 'code' && fallback?.content.trim() ? { type, content, fallback } : { type, content },
      ),
    }
    const saved = props.id ? await api.updateCase(Number(props.id), body) : await api.createCase(body)
    if (thenRun) {
      const { runId } = await api.runCase(saved.id)
      router.push(`/runs/${runId}`)
    } else {
      toast(props.id ? '用例已保存' : '用例已创建')
      router.push('/cases')
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ id ? '编辑用例' : '新建用例' }}</h1>
        <div class="sub">自然语言步骤由 Midscene 视觉模型理解截图后执行；代码步骤直接运行 Playwright；接口步骤发 HTTP 请求并断言。</div>
      </div>
    </div>
    <div v-if="!canEdit" class="alert warn"><AlertCircle :size="16" />演示站点为只读：可以查看用例内容，登录后才能保存修改。</div>
    <div v-if="error" class="alert error" data-test="form-error"><AlertCircle :size="16" />{{ error }}</div>
    <form @submit.prevent="save()" v-if="loaded" class="layout">
      <div class="main-col">
        <div class="card">
          <h2>基本信息</h2>
          <div class="field">
            <label>用例名称</label>
            <input class="input" v-model="form.name" data-test="case-name-input" placeholder="例如：登录成功后进入待办页" />
          </div>
          <div class="field">
            <label>描述（可选）</label>
            <input class="input" v-model="form.description" data-test="case-desc-input" placeholder="覆盖的场景、前置条件" />
          </div>
          <div class="field" style="margin-bottom: 0">
            <label>目标 URL</label>
            <input class="input num" v-model="form.url" data-test="case-url-input" />
            <div class="hint">
              <code v-pre>{{DEMO}}</code> 为内置演示站点（账号 demo / demo123），<code v-pre>{{BASE_URL}}</code> 取当前环境的基础地址；纯接口用例可以留空，不会打开浏览器。
            </div>
          </div>
        </div>
        <StepsEditor v-model="form.steps" />
      </div>

      <aside class="side">
        <div class="card sticky">
          <button class="btn primary block" type="submit" :disabled="saving || !canEdit" data-test="save-case"><Save :size="15" />保存用例</button>
          <button class="btn block" type="button" :disabled="saving || !canEdit" @click="save(true)" data-test="save-run"><Play :size="14" />保存并运行</button>
          <RouterLink class="btn block" to="/cases">取消</RouterLink>
          <div class="hint" style="text-align: center">⌘S / Ctrl+S 保存</div>
          <div class="stats">
            <div><span class="num">{{ form.steps.length }}</span>步骤</div>
            <div><span class="num">{{ counts.code }}</span>代码</div>
            <div><span class="num">{{ counts.ai }}</span>AI</div>
            <div><span class="num">{{ counts.api }}</span>接口</div>
          </div>
          <div class="tip">
            <Lightbulb :size="14" />
            <div>
              操作和造数据优先用选择器或接口（快、确定）；“看起来对不对”交给 AI 断言。
              <template v-if="counts.code && !counts.fallback">可以给关键的代码步骤设置 AI 兜底，界面改版时不至于整条用例失败。</template>
            </div>
          </div>
        </div>
      </aside>
    </form>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; align-items: start; }
.sticky { position: sticky; top: 72px; display: flex; flex-direction: column; gap: 8px; }
.block { width: 100%; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); text-align: center; margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--muted); }
.stats .num { display: block; font-size: 18px; font-weight: 600; color: var(--text); }
.tip { display: flex; gap: 8px; margin-top: 8px; padding: 10px; border-radius: 8px; background: #fffaeb; color: #7a5a00; font-size: 12px; line-height: 1.6; }
.tip svg { flex: none; margin-top: 2px; }
@media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } .sticky { position: static; } }
</style>
