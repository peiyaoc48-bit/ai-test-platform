import { describe, expect, it } from 'vitest'
import { openDb } from '../../server/db'
import { countTransitions, findFlaky, getDashboard } from '../../server/repo/dashboard'
import { createCase } from '../../server/repo/cases'
import { SAMPLE_CASES } from '../../server/seed'
import type { RunStatus } from '../../shared/types'

describe('countTransitions', () => {
  it.each([
    [['passed', 'passed', 'passed'], 0],
    [['passed', 'failed', 'passed'], 2],
    [['failed', 'error', 'passed'], 1], // failed 与 error 都算失败
    [['passed', 'skipped', 'failed'], 1], // 跳过的不计
    [[], 0],
  ] as const)('%j -> %i', (s, n) => expect(countTransitions([...s] as RunStatus[])).toBe(n))
})

describe('不稳定用例与概览', () => {
  const setup = (history: Record<string, (RunStatus | [RunStatus, string])[]>) => {
    const db = openDb(':memory:')
    const ids: Record<string, number> = {}
    for (const [name, runs] of Object.entries(history)) {
      const c = createCase(db, { ...SAMPLE_CASES[0], name })
      ids[name] = c.id
      for (const r of runs) {
        const [status, mutation] = Array.isArray(r) ? r : [r, 'none']
        db.prepare(`INSERT INTO runs (case_id, case_name, url, status, mutation, started_at, finished_at) VALUES (?, ?, '', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(c.id, name, status, mutation)
      }
    }
    return { db, ids }
  }

  it('最近 10 次中通过 / 失败切换 ≥ 2 次才算不稳定；变更注入的运行不参与', () => {
    const { db } = setup({
      稳定: ['passed', 'passed', 'passed'],
      一直失败: ['failed', 'failed'],
      反复: ['passed', 'failed', 'passed', 'failed'],
      只因变更注入失败: ['passed', ['failed', 'attr'], 'passed', ['failed', 'attr'], 'passed'],
      早期反复但最近稳定: ['passed', 'failed', 'passed', ...Array(10).fill('passed')],
    })
    const flaky = findFlaky(db)
    expect(flaky.map((f) => f.caseName)).toEqual(['反复'])
    expect(flaky[0]).toMatchObject({ transitions: 3, passRate: 0.5, recent: ['passed', 'failed', 'passed', 'failed'] })
  })

  it('最近失败只看每个用例最近一次（非变更注入）运行', () => {
    const { db } = setup({ 先失败后通过: ['failed', 'passed'], 最近失败: ['passed', 'failed'], 注入后失败: ['passed', ['failed', 'style']] })
    const d = getDashboard(db)
    expect(d.failing.map((r) => r.caseName)).toEqual(['最近失败'])
    expect(d.counts.cases).toBe(3)
    expect(d.week.totalRuns).toBe(5) // 注入变更的运行不计入统计
  })
})
