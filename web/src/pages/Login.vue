<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { AlertCircle, LockKeyhole } from 'lucide-vue-next'
import { api } from '../api'
import { loadSession, session } from '../session'

const route = useRoute()
const code = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await api.login(code.value)
    await loadSession()
    location.assign(typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/dashboard')
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login" @submit.prevent="submit">
      <div class="logo"><LockKeyhole :size="20" /></div>
      <h1>AI 测试平台</h1>
      <p class="muted">输入访问口令后可以编辑用例、环境和用例集。</p>
      <div v-if="error" class="alert error"><AlertCircle :size="16" />{{ error }}</div>
      <input class="input" type="password" v-model="code" placeholder="访问口令" autocomplete="current-password" autofocus data-test="access-code" />
      <button class="btn primary" type="submit" :disabled="!code || loading" data-test="login">登录</button>
      <RouterLink v-if="session.publicDemo" to="/dashboard" class="muted guest">以访客身份只读浏览 →</RouterLink>
    </form>
  </div>
</template>

<style scoped>
.login-wrap { min-height: 100vh; display: grid; place-items: center; background: radial-gradient(1200px 600px at 20% -10%, #1d5bd833, transparent), var(--nav); padding: 16px; }
.login { width: min(360px, 100%); background: #fff; border-radius: 14px; padding: 28px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; gap: 12px; }
.logo { width: 40px; height: 40px; border-radius: 10px; background: var(--brand-soft); color: var(--brand); display: grid; place-items: center; }
h1 { margin: 4px 0 0; font-size: 18px; }
p { margin: 0 0 4px; font-size: 13px; }
.btn { height: 38px; }
.input { height: 38px; }
.guest { text-align: center; font-size: 12.5px; }
</style>
