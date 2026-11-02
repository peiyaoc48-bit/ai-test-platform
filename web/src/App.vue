<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { BarChart3, Boxes, ChevronRight, ClipboardCheck, Eye, FileText, LayoutDashboard, LogIn, LogOut, Server, ShieldCheck, Sparkles } from 'lucide-vue-next'
import { currentEnvId } from './env-store'
import { api } from './api'
import FeedbackLayer from './ui/FeedbackLayer.vue'
import { loadSession, session } from './session'
import { toast } from './ui/feedback'
import type { Environment, PlatformConfig } from '../../shared/types'

const route = useRoute()
const config = ref<PlatformConfig | null>(null)
const envs = ref<Environment[]>([])
const counts = ref<{ cases: number; suites: number }>({ cases: 0, suites: 0 })

const loadMeta = async () => {
  const [e, c, s] = await Promise.all([api.listEnvs(), api.listCases(), api.listSuites()])
  envs.value = e
  counts.value = { cases: c.length, suites: s.length }
  // 当前环境已被删除时回到默认
  if (currentEnvId.value && !envs.value.some((x) => x.id === currentEnvId.value)) currentEnvId.value = null
}
onMounted(async () => {
  if (route.meta.bare) return
  config.value = await api.config()
  await loadMeta()
})
async function logout() {
  await api.logout()
  await loadSession()
  toast('已退出登录', 'info')
}
// 增删改后回到其他页面时刷新计数和环境下拉框
watch(() => route.path, () => !route.meta.bare && loadMeta())

const groups = computed(() => [
  { title: '', items: [{ key: 'dashboard', to: '/dashboard', label: '概览', icon: LayoutDashboard }] },
  {
    title: '测试资产',
    items: [
      { key: 'cases', to: '/cases', label: '用例管理', icon: FileText, count: counts.value.cases },
      { key: 'suites', to: '/suites', label: '用例集', icon: Boxes, count: counts.value.suites },
      { key: 'envs', to: '/environments', label: '环境', icon: Server, count: envs.value.length },
    ],
  },
  { title: '执行与分析', items: [{ key: 'reports', to: '/reports', label: '测试报告', icon: BarChart3 }] },
  {
    title: 'AI 能力',
    items: [
      { key: 'workshop', to: '/workshop', label: '用例工坊', icon: ClipboardCheck },
      { key: 'generate', to: '/generate', label: '快速生成', icon: Sparkles },
    ],
  },
])

/** 面包屑：路由 meta.crumbs 为 [{ label, to? }]，最后一项为当前页 */
const crumbs = computed(() => (route.meta.crumbs as { label: string; to?: string }[] | undefined) ?? [])
</script>

<template>
  <RouterView v-if="route.meta.bare" />
  <div class="shell" v-else>
    <aside class="sidebar">
      <RouterLink to="/dashboard" class="brand">
        <span class="brand-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <span>AI 测试平台<small>UI · 接口 · 视觉断言</small></span>
      </RouterLink>
      <nav>
        <div v-for="g in groups" :key="g.title" class="nav-group">
          <div v-if="g.title" class="nav-group-title">{{ g.title }}</div>
          <RouterLink v-for="n in g.items" :key="n.key" :to="n.to" class="nav-item" :class="{ active: route.meta.nav === n.key }" :data-test="`nav-${n.key}`">
            <component :is="n.icon" :size="16" />
            {{ n.label }}
            <span v-if="'count' in n && n.count" class="count">{{ n.count }}</span>
          </RouterLink>
        </div>
      </nav>
      <div class="sidebar-foot" v-if="config" data-test="model-status">
        <div style="display: flex; align-items: center; gap: 8px">
          <span class="dot" :class="{ on: config.modelConfigured }"></span>
          {{ config.modelConfigured ? config.modelName : '未配置模型' }}
        </div>
        <div style="margin-top: 4px; font-size: 11px; opacity: .7">
          {{ config.modelConfigured ? '视觉模型已就绪' : '自然语言步骤将跳过' }}
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="header">
        <nav class="crumbs" aria-label="面包屑">
          <template v-for="(c, i) in crumbs" :key="i">
            <ChevronRight v-if="i" :size="14" />
            <RouterLink v-if="c.to && i < crumbs.length - 1" :to="c.to">{{ c.label }}</RouterLink>
            <span v-else :class="{ cur: i === crumbs.length - 1 }">{{ c.label }}</span>
          </template>
        </nav>
        <div class="header-right">
          <span v-if="session.role === 'viewer'" class="role viewer" data-test="role"><Eye :size="13" />访客 · 只读</span>
          <span v-else-if="session.authRequired" class="role admin" data-test="role"><ShieldCheck :size="13" />管理员</span>
          <RouterLink v-if="session.role === 'viewer'" class="btn sm" to="/login" data-test="to-login"><LogIn :size="13" />登录</RouterLink>
          <button v-else-if="session.authRequired" class="btn sm" @click="logout" data-test="logout"><LogOut :size="13" />退出</button>
          <label class="env-switch" title="单个用例运行、批量运行和导出都使用当前环境">
            <Server :size="14" />
            环境
            <select v-model="currentEnvId" data-test="env-select">
              <option :value="null">默认（演示站点）</option>
              <option v-for="e in envs" :key="e.id" :value="e.id">{{ e.name }}</option>
            </select>
          </label>
        </div>
      </header>
      <RouterView />
    </div>
  </div>
  <FeedbackLayer />
</template>

<style scoped>
.role { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 12px; font-size: 12px; }
.role.viewer { background: var(--skip-soft); color: var(--skip); }
.role.admin { background: var(--pass-soft); color: var(--pass); }
</style>
