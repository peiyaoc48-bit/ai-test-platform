<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'

const props = defineProps<{ id?: string }>()
const router = useRouter()
const PERMS = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write']
// 变量、本地存储用“名称=值”每行一条，启动参数每行一个，编辑更直观
const form = reactive({ name: '', description: '', baseUrl: '', vars: '', launchArgs: '', permissions: [] as string[], localStorage: '', stepTimeoutMs: '' })
const error = ref('')
const loaded = ref(!props.id)

const toLines = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n')
function toMap(text: string, what: string) {
  const out: Record<string, string> = {}
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`${what}第 ${i + 1} 行需要是“名称=值”`)
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

onMounted(async () => {
  if (!props.id) return
  const e = await api.getEnv(Number(props.id))
  Object.assign(form, {
    name: e.name,
    description: e.description,
    baseUrl: e.baseUrl,
    vars: toLines(e.vars),
    launchArgs: e.launchArgs.join('\n'),
    permissions: [...e.permissions],
    localStorage: toLines(e.localStorage),
    stepTimeoutMs: e.stepTimeoutMs ? String(e.stepTimeoutMs) : '',
  })
  loaded.value = true
})

async function save() {
  error.value = ''
  try {
    const body = {
      name: form.name,
      description: form.description,
      baseUrl: form.baseUrl,
      vars: toMap(form.vars, '变量'),
      launchArgs: form.launchArgs.split('\n').map((s) => s.trim()).filter(Boolean),
      permissions: form.permissions,
      localStorage: toMap(form.localStorage, '本地存储'),
      stepTimeoutMs: form.stepTimeoutMs ? Number(form.stepTimeoutMs) : null,
    }
    if (props.id) await api.updateEnv(Number(props.id), body)
    else await api.createEnv(body)
    router.push('/environments')
  } catch (e: any) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="page" v-if="loaded">
    <div class="page-head"><h1>{{ id ? '编辑环境' : '新建环境' }}</h1></div>
    <div v-if="error" class="alert error" data-test="env-error">{{ error }}</div>
    <form @submit.prevent="save">
      <div class="card">
        <div class="field"><label>名称</label><input class="input" v-model="form.name" data-test="env-name" placeholder="例如：测试环境、在线监考（本地）" /></div>
        <div class="field"><label>描述（可选）</label><input class="input" v-model="form.description" /></div>
        <div class="field" style="margin-bottom: 0">
          <label>基础地址</label>
          <input class="input num" v-model="form.baseUrl" data-test="env-base-url" placeholder="http://localhost:5174" />
          <div class="hint">用例 URL 写成 <code v-pre>{{BASE_URL}}/login</code>，换环境时不用改用例。</div>
        </div>
      </div>
      <div class="card">
        <h2>变量</h2>
        <textarea class="textarea code" v-model="form.vars" rows="4" data-test="env-vars" placeholder="API=http://localhost:8081&#10;USERNAME=student01"></textarea>
        <div class="hint">每行一个“名称=值”。接口步骤和 URL 中用 <code v-pre>{{名称}}</code> 引用，代码步骤中用 <code>vars.名称</code> 读取。</div>
      </div>
      <div class="card">
        <h2>浏览器</h2>
        <div class="field">
          <label>启动参数（每行一个）</label>
          <textarea class="textarea code" v-model="form.launchArgs" rows="4" data-test="env-args" placeholder="--use-fake-ui-for-media-stream&#10;--use-fake-device-for-media-stream"></textarea>
          <div class="hint">例如用 Chrome 模拟摄像头：<code>--use-fake-device-for-media-stream</code>、<code>--use-file-for-fake-video-capture=/path/to/video.y4m</code>（可引用变量）。</div>
        </div>
        <div class="field">
          <label>权限</label>
          <label v-for="p in PERMS" :key="p" class="perm"><input type="checkbox" :value="p" v-model="form.permissions" :data-test="`perm-${p}`" /> {{ p }}</label>
        </div>
        <div class="field">
          <label>预置本地存储（localStorage，每行“键=值”）</label>
          <textarea class="textarea code" v-model="form.localStorage" rows="3" data-test="env-storage" placeholder="agreed=1"></textarea>
          <div class="hint">在页面脚本执行前写入，用来跳过“同意协议”“新手引导”等前置步骤。</div>
        </div>
        <div class="field" style="margin-bottom: 0">
          <label>单步超时（毫秒，可选）</label>
          <input class="input num" v-model="form.stepTimeoutMs" style="width: 200px" placeholder="默认 15000" data-test="env-timeout" />
        </div>
      </div>
      <div style="display: flex; gap: 8px">
        <button class="btn primary" type="submit" data-test="save-env">保存环境</button>
        <RouterLink class="btn" to="/environments">取消</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
.perm { display: inline-flex; gap: 4px; align-items: center; margin-right: 14px; font-size: 13px; cursor: pointer; }
</style>
