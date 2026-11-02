import type { CoverageStatus, Proportion } from '../../../../shared/types'

export const pct = (r: number | null | undefined, digits = 1) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(digits)}%`)

/** 比例 + 置信区间，如 “85.0%（18/20，95% CI 69.9–97.2%）” 的各部分 */
export function propParts(p: Proportion) {
  return {
    rate: pct(p.rate),
    frac: `${p.k}/${p.n}`,
    ci: p.ci ? `${(p.ci[0] * 100).toFixed(0)}–${(p.ci[1] * 100).toFixed(0)}%` : '',
  }
}

export const COVERAGE_TAG: Record<CoverageStatus, string> = { uncovered: 'failed', linked: 'queued', verified: 'passed', failed: 'error' }

export const batchName = (seq: number) => `batch-${seq}`
