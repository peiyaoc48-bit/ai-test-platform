<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import type { Environment, SuiteInput, TestCase } from '../../../shared/types'

const props = defineProps<{ id?: string }>()
const router = useRouter()
const cases = ref<TestCase[]>([])
const form = reactive<SuiteInput>({ name: '', description: '', caseIds: [], envId: null })
const envs = ref<Environment[]>([])
const error = ref('')
const loaded = ref(false)

onMounted(async () => {
  ;[cases.value, envs.value] = await Promise.all([api.listCases(), api.listEnvs()])
  if (props.id) {
    const s = await api.getSuite(Number(props.id))
    // 已删除的用例不再显示
    Object.assign(form, { name: s.name, description: s.description, envId: s.envId, caseIds: s.caseIds.filter((id) => cases.value.some((c) => c.id === id)) })
  }
  loaded.value = true
})

const selected = computed(() => form.caseIds.map((id) => cases.value.find((c) => c.id === id)!).filter(Boolean))
function toggle(id: number) {
  const i = form.caseIds.indexOf(id)
  if (i >= 0) form.caseIds.splice(i, 1)
  else form.caseIds.push(id)
}
async function save() {
  error.value = ''
  try {
    if (props.id) await api.updateSuite(Number(props.id), form)
    else await api.createSuite(form)
    router.push('/suites')
  } catch (e: any) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="page" v-if="loaded">
    <div class="page-head"><h1>{{ id ? '编辑用例集' : '新建用例集' }}</h1></div>
    <div v-if="error" class="alert error" data-test="suite-error">{{ error }}</div>
    <form @submit.prevent="save">
      <div class="card">
        <div class="field"><label>名称</label><input class="input" v-model="form.name" data-test="suite-name" placeholder="例如：冒烟、每日回归" /></div>
        <div class="field"><label>描述（可选）</label><input class="input" v-model="form.description" /></div>
        <div class="field" style="margin-bottom: 0">
          <label>默认环境</label>
          <select class="select" v-model="form.envId" style="width: 280px" data-test="suite-env">
            <option :value="null">默认（演示站点）</option>
            <option v-for="e in envs" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
          <div class="hint">CI 触发或在列表点“运行”时使用这个环境。</div>
        </div>
      </div>
      <div class="card">
        <h2>选择用例 <span class="muted num" style="font-weight: 400">（已选 {{ form.caseIds.length }}，按勾选顺序执行）</span></h2>
        <label v-for="c in cases" :key="c.id" class="pick" data-test="suite-case">
          <input type="checkbox" :checked="form.caseIds.includes(c.id)" @change="toggle(c.id)" />
          <span class="num muted">#{{ c.id }}</span>
          <span>{{ c.name }}</span>
          <span v-if="form.caseIds.includes(c.id)" class="tag num" style="margin-left: auto">第 {{ form.caseIds.indexOf(c.id) + 1 }} 个</span>
        </label>
        <div v-if="!cases.length" class="empty">还没有用例。</div>
      </div>
      <div style="display: flex; gap: 8px">
        <button class="btn primary" type="submit" data-test="save-suite">保存用例集</button>
        <RouterLink class="btn" to="/suites">取消</RouterLink>
      </div>
      <div class="hint" v-if="selected.length" style="margin-top: 8px">执行顺序：{{ selected.map((c) => c.name).join(' → ') }}</div>
    </form>
  </div>
</template>

<style scoped>
.pick { display: flex; gap: 10px; align-items: center; padding: 8px 4px; border-bottom: 1px solid var(--border); cursor: pointer; }
.pick:last-of-type { border-bottom: 0; }
</style>
