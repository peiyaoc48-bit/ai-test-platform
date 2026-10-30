import type { DashboardData, FlakyCase, RunStatus } from '../../shared/types.js'
import type { DB } from '../db.js'
import { getStats, listRuns } from './runs.js'

/**
 * 不稳定用例：最近 N 次有结论的运行（排除跳过和变更注入）中，“通过 ↔ 失败”切换次数达到阈值。
 * 参考 Allure TestOps 的做法（其默认为最近 10 次中切换 ≥ 3 次）；个人项目运行次数少，阈值取 2。
 */
export const FLAKY_WINDOW = 10
export const FLAKY_MIN_TRANSITIONS = 2

export function countTransitions(statuses: RunStatus[]): number {
  const outcome = statuses.filter((s) => s !== 'skipped').map((s) => (s === 'passed' ? 'P' : 'F'))
  let n = 0
  for (let i = 1; i < outcome.length; i++) if (outcome[i] !== outcome[i - 1]) n++
  return n
}

export function findFlaky(db: DB): FlakyCase[] {
  const rows = db
    .prepare(
      `SELECT case_id, case_name, status FROM (
         SELECT r.*, ROW_NUMBER() OVER (PARTITION BY case_id ORDER BY id DESC) AS rn
         FROM runs r
         WHERE status IN ('passed', 'failed', 'error') AND COALESCE(mutation, 'none') = 'none'
       ) WHERE rn <= ? ORDER BY case_id, id`,
    )
    .all(FLAKY_WINDOW) as { case_id: number; case_name: string; status: RunStatus }[]
  const byCase = new Map<number, { name: string; statuses: RunStatus[] }>()
  for (const r of rows) {
    const c = byCase.get(r.case_id) ?? { name: r.case_name, statuses: [] }
    c.statuses.push(r.status)
    c.name = r.case_name
    byCase.set(r.case_id, c)
  }
  return [...byCase.entries()]
    .map(([caseId, c]) => ({
      caseId,
      caseName: c.name,
      transitions: countTransitions(c.statuses),
      passRate: c.statuses.filter((s) => s === 'passed').length / c.statuses.length,
      recent: c.statuses,
    }))
    .filter((f) => f.transitions >= FLAKY_MIN_TRANSITIONS)
    .sort((a, b) => b.transitions - a.transitions)
}

export function getDashboard(db: DB): DashboardData {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  const cur = getStats(db, { days: 7 })
  const prev14 = getStats(db, { days: 14 })
  // 上一个 7 天 = 近 14 天 - 近 7 天
  const prevPassed = prev14.passedRuns - cur.passedRuns
  const prevDecided = prev14.passedRuns + prev14.failedRuns - (cur.passedRuns + cur.failedRuns)
  const lastFailed = db
    .prepare(
      `SELECT r.id FROM runs r WHERE r.id IN (SELECT MAX(id) FROM runs WHERE COALESCE(mutation, 'none') = 'none' GROUP BY case_id)
       AND r.status IN ('failed', 'error') AND r.case_id IN (SELECT id FROM cases) ORDER BY r.id DESC LIMIT 6`,
    )
    .all() as { id: number }[]
  const failingIds = new Set(lastFailed.map((r) => r.id))
  return {
    counts: {
      cases: count('SELECT COUNT(*) AS n FROM cases'),
      suites: count('SELECT COUNT(*) AS n FROM suites'),
      environments: count('SELECT COUNT(*) AS n FROM environments'),
      aiSteps: count(`SELECT COUNT(*) AS n FROM cases, json_each(cases.steps) s WHERE json_extract(s.value, '$.type') LIKE 'ai_%'`),
      apiSteps: count(`SELECT COUNT(*) AS n FROM cases, json_each(cases.steps) s WHERE json_extract(s.value, '$.type') = 'api'`),
      codeSteps: count(`SELECT COUNT(*) AS n FROM cases, json_each(cases.steps) s WHERE json_extract(s.value, '$.type') = 'code'`),
    },
    week: cur,
    prevPassRate: prevDecided > 0 ? prevPassed / prevDecided : null,
    daily: getStats(db, { days: 14 }).daily,
    failing: listRuns(db, { limit: 200 }).filter((r) => failingIds.has(r.id)),
    flaky: findFlaky(db),
    recent: listRuns(db, { limit: 8 }),
    flakyRule: { window: FLAKY_WINDOW, minTransitions: FLAKY_MIN_TRANSITIONS },
  }
}
