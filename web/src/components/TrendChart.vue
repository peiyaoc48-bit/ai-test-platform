<script setup lang="ts">
// 单序列趋势图（折线或柱状），带悬浮提示。单序列不画图例，标题即说明。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface Point {
  label: string
  value: number
  /** 悬浮提示第二行 */
  detail?: string
  /** 点击跳转 */
  href?: string
  highlight?: boolean
}

const props = withDefaults(
  defineProps<{ points: Point[]; kind?: 'line' | 'column'; max?: number; format?: (v: number) => string; height?: number }>(),
  { kind: 'line', height: 200, format: (v: number) => String(v) },
)
const emit = defineEmits<{ select: [p: Point] }>()

const el = ref<HTMLDivElement>()
const width = ref(0)
let ro: ResizeObserver | undefined
onMounted(() => {
  width.value = Math.max(240, el.value!.clientWidth)
  ro = new ResizeObserver(([e]) => (width.value = Math.max(240, e.contentRect.width)))
  ro.observe(el.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const pad = { top: 12, right: 12, bottom: 26, left: 44 }
const innerW = computed(() => width.value - pad.left - pad.right)
const innerH = computed(() => props.height - pad.top - pad.bottom)

/** 取整的刻度上限 */
function niceMax(v: number) {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}
const yMax = computed(() => props.max ?? niceMax(Math.max(...props.points.map((p) => p.value), 0)))
const ticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax.value))
const y = (v: number) => pad.top + innerH.value * (1 - v / yMax.value)
const band = computed(() => innerW.value / Math.max(props.points.length, 1))
const x = (i: number) => pad.left + band.value * (i + 0.5)
const barW = computed(() => Math.min(24, band.value - 2))

const linePath = computed(() => props.points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(''))
const areaPath = computed(() =>
  props.points.length
    ? `${linePath.value}L${x(props.points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
    : '',
)
/** 顶部 4px 圆角、底部直角的柱子 */
function colPath(i: number, v: number) {
  const w = barW.value, x0 = x(i) - w / 2, top = y(v), base = y(0)
  const r = Math.min(4, w / 2, base - top)
  return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${base}Z`
}
// x 轴标签过密时抽稀
const labelEvery = computed(() => Math.ceil(props.points.length / Math.max(1, Math.floor(innerW.value / 64))))

const hover = ref<number | null>(null)
function onMove(e: PointerEvent) {
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
  const i = Math.floor((e.clientX - rect.left - pad.left) / band.value)
  hover.value = i >= 0 && i < props.points.length ? i : null
}
const tip = computed(() => {
  if (hover.value === null) return null
  const p = props.points[hover.value]
  const left = Math.min(Math.max(x(hover.value) - 70, 0), width.value - 150)
  return { p, left, top: Math.max(y(p.value) - 64, 0) }
})
</script>

<template>
  <div class="chart" ref="el">
    <svg :width="width" :height="height" @pointermove="onMove" @pointerleave="hover = null"
      @click="hover !== null && emit('select', points[hover])" :style="{ cursor: hover !== null && points[hover]?.href ? 'pointer' : 'default' }">
      <g class="grid">
        <template v-for="t in ticks" :key="t">
          <line :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" />
          <text :x="pad.left - 8" :y="y(t) + 4" text-anchor="end">{{ format(t) }}</text>
        </template>
      </g>
      <g class="xaxis">
        <template v-for="(p, i) in points" :key="i">
          <text v-if="i % labelEvery === 0" :x="x(i)" :y="height - 8" text-anchor="middle">{{ p.label }}</text>
        </template>
      </g>
      <template v-if="kind === 'line'">
        <line v-if="hover !== null" class="crosshair" :x1="x(hover)" :x2="x(hover)" :y1="pad.top" :y2="y(0)" />
        <path :d="areaPath" class="area" />
        <path :d="linePath" class="line" />
        <circle v-for="(p, i) in points" :key="i" :cx="x(i)" :cy="y(p.value)" :r="hover === i ? 5 : 4" class="dot" />
      </template>
      <template v-else>
        <path v-for="(p, i) in points" :key="i" :d="colPath(i, p.value)" class="col"
          :class="{ hl: p.highlight, dim: hover !== null && hover !== i }" />
      </template>
    </svg>
    <div v-if="tip" class="tip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
      <strong class="num">{{ format(tip.p.value) }}</strong>
      <div>{{ tip.p.label }}</div>
      <div v-if="tip.p.detail" class="muted">{{ tip.p.detail }}</div>
    </div>
  </div>
</template>

<style scoped>
.chart { position: relative; width: 100%; min-width: 0; overflow: hidden; }
svg { display: block; }
.grid line { stroke: #edf0f5; stroke-width: 1; }
.grid text, .xaxis text { fill: var(--muted); font-size: 11px; font-family: var(--mono); }
.line { fill: none; stroke: var(--brand); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.area { fill: var(--brand); opacity: 0.1; }
.dot { fill: var(--brand); stroke: #fff; stroke-width: 2; }
.crosshair { stroke: #c9d1de; stroke-width: 1; }
.col { fill: var(--brand); transition: opacity .1s; }
.col.hl { fill: var(--fail); }
.col.dim { opacity: .55; }
.tip { position: absolute; pointer-events: none; background: #fff; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 14px rgba(15, 30, 61, .12); padding: 6px 10px; font-size: 12px; min-width: 140px; }
.tip strong { font-size: 14px; }
</style>
