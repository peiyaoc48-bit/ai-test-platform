<script setup lang="ts">
// 接口步骤的请求 / 响应摘要（默认折叠响应体）
defineProps<{
  result: {
    request: { method: string; url: string; headers: Record<string, string>; body?: unknown }
    response: { status: number; ms: number; body: unknown }
    extracted: Record<string, unknown>
  }
}>()
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
</script>

<template>
  <div class="ex" data-test="api-exchange">
    <div class="line num">
      <span class="method">{{ result.request.method }}</span>
      <span class="url">{{ result.request.url }}</span>
      <span class="status" :class="result.response.status < 400 ? 'ok' : 'bad'">{{ result.response.status }}</span>
      <span class="muted">{{ result.response.ms }} ms</span>
    </div>
    <div v-if="Object.keys(result.extracted ?? {}).length" class="extracted">
      <span class="muted">提取变量：</span>
      <code v-for="(v, k) in result.extracted" :key="k" class="num">{{ k }} = {{ JSON.stringify(v) }}</code>
    </div>
    <details>
      <summary class="muted">请求与响应详情</summary>
      <div class="cols">
        <div><div class="muted">请求体</div><pre class="code">{{ result.request.body === undefined ? '（无）' : pretty(result.request.body) }}</pre></div>
        <div><div class="muted">响应体</div><pre class="code">{{ result.response.body === '' ? '（空）' : pretty(result.response.body) }}</pre></div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.ex { margin-top: 8px; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: #fbfcfe; font-size: 12.5px; }
.line { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.method { font-weight: 600; color: #0e6a78; }
.url { word-break: break-all; }
.status { font-weight: 600; padding: 0 6px; border-radius: 4px; }
.status.ok { background: var(--pass-soft); color: var(--pass); }
.status.bad { background: var(--fail-soft); color: var(--fail); }
.extracted { margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; }
details { margin-top: 6px; }
summary { cursor: pointer; font-size: 12px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
.cols pre { background: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; max-height: 260px; overflow: auto; }
</style>
