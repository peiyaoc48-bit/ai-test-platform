<script setup lang="ts">
// 状态徽标：颜色 + 图标 + 文字，状态不只靠颜色区分
import { computed } from 'vue'
import { Ban, CheckCircle2, CircleDashed, Clock3, Loader2, MinusCircle, Sparkles, XCircle } from 'lucide-vue-next'
import { RUN_STATUS_LABEL, STEP_STATUS_LABEL } from '../format'

const props = defineProps<{ status: string; size?: 'sm' | 'md' }>()
const ICONS: Record<string, unknown> = {
  passed: CheckCircle2,
  failed: XCircle,
  error: Ban,
  skipped: MinusCircle,
  running: Loader2,
  queued: Clock3,
  pending: CircleDashed,
  not_run: CircleDashed,
  healed: Sparkles,
}
const label = computed(() => (RUN_STATUS_LABEL as Record<string, string>)[props.status] ?? (STEP_STATUS_LABEL as Record<string, string>)[props.status] ?? props.status)
</script>

<template>
  <span class="badge" :class="[status, size ?? 'md']">
    <component :is="ICONS[status] ?? CircleDashed" :size="size === 'sm' ? 12 : 13" :class="{ spin: status === 'running' }" />
    {{ label }}
  </span>
</template>

<style scoped>
.badge { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px 0 6px; border-radius: 11px; font-size: 12px; font-weight: 500; white-space: nowrap; background: #eef1f6; color: var(--muted); }
.badge.sm { height: 20px; font-size: 11.5px; }
.passed { background: var(--pass-soft); color: var(--pass); }
.failed, .error { background: var(--fail-soft); color: var(--fail); }
.skipped { background: var(--skip-soft); color: var(--skip); }
.running, .queued { background: var(--brand-soft); color: var(--brand); }
.healed { background: #e9f2ff; color: #1b5fb4; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
