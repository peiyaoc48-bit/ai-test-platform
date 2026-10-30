<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import StepsEditor from '../components/StepsEditor.vue'
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
  if (!props.id) return
  const c = await api.getCase(Number(props.id))
  Object.assign(form, { name: c.name, description: c.description, url: c.url, steps: c.steps })
  loaded.value = true
})

async function save() {
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
    if (props.id) await api.updateCase(Number(props.id), body)
    else await api.createCase(body)
    router.push('/cases')
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
        <div class="sub">自然语言步骤由 Midscene 视觉模型理解截图后执行；代码步骤直接运行 Playwright。</div>
      </div>
    </div>
    <div v-if="error" class="alert error" data-test="form-error">{{ error }}</div>
    <form @submit.prevent="save" v-if="loaded">
      <div class="card">
        <h2>基本信息</h2>
        <div class="field">
          <label>用例名称</label>
          <input class="input" v-model="form.name" data-test="case-name-input" placeholder="例如：登录成功后进入待办页" />
        </div>
        <div class="field">
          <label>描述（可选）</label>
          <input class="input" v-model="form.description" data-test="case-desc-input" />
        </div>
        <div class="field" style="margin-bottom: 0">
          <label>目标 URL</label>
          <input class="input num" v-model="form.url" data-test="case-url-input" />
          <div class="hint"><code v-pre>{{DEMO}}</code> 会被替换为平台自带的演示站点地址（登录 + 待办列表，账号 demo / demo123）；纯接口用例可以留空，不会打开浏览器。</div>
        </div>
      </div>
      <StepsEditor v-model="form.steps" />
      <div style="display: flex; gap: 8px">
        <button class="btn primary" type="submit" :disabled="saving" data-test="save-case">保存用例</button>
        <RouterLink class="btn" to="/cases">取消</RouterLink>
      </div>
    </form>
  </div>
</template>
