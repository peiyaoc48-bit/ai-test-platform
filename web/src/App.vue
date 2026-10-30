<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from './api'
import type { PlatformConfig } from '../../shared/types'

const route = useRoute()
const config = ref<PlatformConfig | null>(null)
onMounted(async () => (config.value = await api.config()))
const navs = [
  { key: 'cases', to: '/cases', label: '用例管理' },
  { key: 'suites', to: '/suites', label: '用例集' },
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
    <div class="model" v-if="config" data-test="model-status">
      <span class="dot" :class="{ on: config.modelConfigured }"></span>
      {{ config.modelConfigured ? `模型：${config.modelName}` : '未配置模型（自然语言步骤将跳过）' }}
    </div>
  </header>
  <RouterView />
</template>
