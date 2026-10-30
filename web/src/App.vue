<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { currentEnvId } from './env-store'
import { api } from './api'
import type { Environment, PlatformConfig } from '../../shared/types'

const route = useRoute()
const config = ref<PlatformConfig | null>(null)
const envs = ref<Environment[]>([])
const loadEnvs = async () => {
  envs.value = await api.listEnvs()
  // 当前环境已被删除时回到默认
  if (currentEnvId.value && !envs.value.some((e) => e.id === currentEnvId.value)) currentEnvId.value = null
}
onMounted(async () => {
  config.value = await api.config()
  await loadEnvs()
})
// 在环境页增删改后回到其他页面时刷新下拉框
watch(() => route.fullPath, loadEnvs)
const navs = [
  { key: 'cases', to: '/cases', label: '用例管理' },
  { key: 'suites', to: '/suites', label: '用例集' },
  { key: 'envs', to: '/environments', label: '环境' },
  { key: 'generate', to: '/generate', label: 'AI 生成用例' },
  { key: 'reports', to: '/reports', label: '测试报告' },
]
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="logo"><i>✓</i>AI UI 自动化测试平台</RouterLink>
    <nav>
      <RouterLink v-for="n in navs" :key="n.key" :to="n.to" :class="{ active: route.meta.nav === n.key }">{{ n.label }}</RouterLink>
    </nav>
    <label class="env">
      环境
      <select v-model="currentEnvId" data-test="env-select">
        <option :value="null">默认（演示站点）</option>
        <option v-for="e in envs" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
    </label>
    <div class="model" v-if="config" data-test="model-status">
      <span class="dot" :class="{ on: config.modelConfigured }"></span>
      {{ config.modelConfigured ? `模型：${config.modelName}` : '未配置模型（自然语言步骤将跳过）' }}
    </div>
  </header>
  <RouterView />
</template>
