import type { BatchDetail, BatchSummary, EnvSnapshot, RunStatus, Suite, SuiteInput, TestCase } from '../../shared/types.js'
import type { DB } from '../db.js'
import { createRun, listRuns } from './runs.js'

interface SuiteRow {
  id: number
  name: string
  description: string
  case_ids: string
  env_id: number | null
  created_at: string
  updated_at: string
}

const toSuite = (r: SuiteRow): Suite => ({
  id: r.id,
  name: r.name,
  description: r.description,
  caseIds: JSON.parse(r.case_ids),
  envId: r.env_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listSuites(db: DB): Suite[] {
  return (db.prepare('SELECT * FROM suites ORDER BY id DESC').all() as SuiteRow[]).map((r) => {
    const last = db.prepare('SELECT id FROM batches WHERE suite_id = ? ORDER BY id DESC LIMIT 1').get(r.id) as { id: number } | undefined
    return { ...toSuite(r), lastBatch: last ? getBatch(db, last.id) : null }
  })
}

export function getSuite(db: DB, id: number): Suite | null {
  const r = db.prepare('SELECT * FROM suites WHERE id = ?').get(id) as SuiteRow | undefined
  return r ? toSuite(r) : null
}

export function createSuite(db: DB, s: SuiteInput): Suite {
  const info = db
    .prepare('INSERT INTO suites (name, description, case_ids, env_id) VALUES (?, ?, ?, ?)')
    .run(s.name, s.description, JSON.stringify(s.caseIds), s.envId ?? null)
  return getSuite(db, Number(info.lastInsertRowid))!
}

export function updateSuite(db: DB, id: number, s: SuiteInput): Suite | null {
  const info = db
    .prepare(`UPDATE suites SET name = ?, description = ?, case_ids = ?, env_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(s.name, s.description, JSON.stringify(s.caseIds), s.envId ?? null, id)
  return info.changes ? getSuite(db, id) : null
}

export function deleteSuite(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM suites WHERE id = ?').run(id).changes > 0
}

/** 创建批次并为每个用例创建运行记录（同一事务），返回运行 id，交给执行队列 */
export function createBatch(
  db: DB,
  opts: { name: string; suiteId?: number | null; trigger?: 'manual' | 'ci'; cases: TestCase[]; resolveUrl: (url: string) => string; env?: EnvSnapshot | null },
): { batchId: number; runIds: number[] } {
  return db.transaction(() => {
    const batchId = Number(
      db.prepare('INSERT INTO batches (suite_id, name, trigger) VALUES (?, ?, ?)').run(opts.suiteId ?? null, opts.name, opts.trigger ?? 'manual').lastInsertRowid,
    )
    const setBatch = db.prepare('UPDATE runs SET batch_id = ? WHERE id = ?')
    const runIds = opts.cases.map((c) => {
      const runId = createRun(db, c, opts.resolveUrl(c.url), opts.env ?? null)
      setBatch.run(batchId, runId)
      return runId
    })
    return { batchId, runIds }
  })()
}

export function deriveBatchStatus(statuses: RunStatus[]): RunStatus {
  if (!statuses.length) return 'skipped'
  if (statuses.some((s) => s === 'queued' || s === 'running')) return 'running'
  if (statuses.some((s) => s === 'failed' || s === 'error')) return 'failed'
  if (statuses.every((s) => s === 'skipped')) return 'skipped'
  return 'passed'
}

export function getBatch(db: DB, id: number): BatchDetail | null {
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(id) as any
  if (!b) return null
  const runs = listRuns(db, { batchId: id, limit: 1000 }).reverse()
  const times = db
    .prepare('SELECT MIN(started_at) AS s, MAX(finished_at) AS f, COUNT(*) - COUNT(finished_at) AS open FROM runs WHERE batch_id = ?')
    .get(id) as { s: string | null; f: string | null; open: number }
  const summary: BatchSummary = {
    id: b.id,
    suiteId: b.suite_id,
    name: b.name,
    trigger: b.trigger,
    createdAt: b.created_at,
    status: deriveBatchStatus(runs.map((r) => r.status)),
    total: runs.length,
    passed: runs.filter((r) => r.status === 'passed').length,
    failed: runs.filter((r) => r.status === 'failed' || r.status === 'error').length,
    skipped: runs.filter((r) => r.status === 'skipped').length,
    durationMs: times.s && times.f && !times.open ? Date.parse(times.f) - Date.parse(times.s) : 0,
  }
  return { ...summary, runs }
}

export function listBatches(db: DB, limit = 50): BatchSummary[] {
  return (db.prepare('SELECT id FROM batches ORDER BY id DESC LIMIT ?').all(limit) as { id: number }[]).map((r) => {
    const { runs, ...summary } = getBatch(db, r.id)!
    return summary
  })
}
