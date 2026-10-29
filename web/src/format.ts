import type { RunStatus, StepStatus } from '../../shared/types'

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: '排队中',
  running: '运行中',
  passed: '通过',
  failed: '失败',
  error: '异常',
}

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: '等待',
  running: '执行中',
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  not_run: '未执行',
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`
}
