<script setup lang="ts">
// 最近若干次运行结果的小圆点序列（从旧到新），一眼看出是否反复横跳
defineProps<{ statuses: string[] }>()
</script>

<template>
  <span class="dots">
    <i v-for="(s, i) in statuses" :key="i" :class="s" :title="s"></i>
  </span>
</template>

<style scoped>
.dots { display: inline-flex; gap: 3px; align-items: center; }
i { width: 8px; height: 8px; border-radius: 2px; background: #cfd5df; display: inline-block; }
i.passed { background: var(--pass); }
i.failed, i.error { background: var(--fail); }
i.skipped { background: #e0b84a; }
</style>
