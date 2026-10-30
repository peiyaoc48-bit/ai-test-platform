import type { DailyStat, EnvSnapshot, Mutation, RunDetail, RunStatus, RunSummary, Stats, StepResult, TestCase } from '../../shared/types.js'
import type { DB } from '../db.js'

// 运行列表需要的步骤聚合统计
const SUMMARY_SQL = `
SELECT r.*,
  COALESCE(SUM(s.status = 'passed'), 0)  AS passed,
  COALESCE(SUM(s.status = 'failed'), 0)  AS failed,
  COALESCE(SUM(s.status = 'skipped'), 0) AS skipped,
  COUNT(s.idx)                           AS total,
  COALESCE(SUM(s.ai_calls), 0)           AS ai_calls,
  COALESCE(SUM(s.tokens), 0)             AS tokens
FROM runs r LEFT JOIN run_steps s ON s.run_id = r.id`

const toSummary = (r: any): RunSummary => ({
  id: r.id,
  caseId: r.case_id,
  caseName: r.case_name,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  durationMs: r.duration_ms,
  batchId: r.batch_id ?? null,
  envName: r.env_snapshot ? JSON.parse(r.env_snapshot).name : null,
  mutation: r.mutation ?? 'none',
  passed: r.passed,
  failed: r.failed,
  skipped: r.skipped,
  total: r.total,
  aiCalls: r.ai_calls,
  tokens: r.tokens,
  error: r.error,
})

/** 由 runs 表的原始行补齐聚合字段 */
export function rowToSummary(db: DB, row: { id: number }): RunSummary {
  return toSummary(db.prepare(`${SUMMARY_SQL} WHERE r.id = ? GROUP BY r.id`).get(row.id))
}

export interface RunOptions {
  env?: EnvSnapshot | null
  mutation?: Mutation
  continueOnFailure?: boolean
}

export function createRun(db: DB, tc: TestCase, resolvedUrl: string, opts: RunOptions = {}): number {
  const insertRun = db.prepare(
    `INSERT INTO runs (case_id, case_name, url, status, env_snapshot, mutation, continue_on_failure) VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
  )
  const insertStep = db.prepare(`INSERT INTO run_steps (run_id, idx, type, content, status) VALUES (?, ?, ?, ?, 'pending')`)
  return db.transaction(() => {
    const runId = Number(
      insertRun.run(tc.id, tc.name, resolvedUrl, opts.env ? JSON.stringify(opts.env) : null, opts.mutation ?? 'none', opts.continueOnFailure ? 1 : 0)
        .lastInsertRowid,
    )
    tc.steps.forEach((s, i) => insertStep.run(runId, i, s.type, s.content))
    return runId
  })()
}

export function markRunStarted(db: DB, runId: number) {
  db.prepare(`UPDATE runs SET status = 'running', started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(runId)
}

export function finishRun(
  db: DB,
  runId: number,
  r: { status: RunStatus; durationMs: number; error?: string | null; midsceneReport?: string | null },
) {
  db.prepare(
    `UPDATE runs SET status = ?, duration_ms = ?, error = ?, midscene_report = ?,
       finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(r.status, Math.round(r.durationMs), r.error ?? null, r.midsceneReport ?? null, runId)
}

export function updateStep(db: DB, runId: number, idx: number, patch: Partial<StepResult>) {
  const cols: Record<string, unknown> = {
    status: patch.status,
    duration_ms: patch.durationMs === undefined ? undefined : Math.round(patch.durationMs),
    error: patch.error,
    screenshot: patch.screenshot,
    output: patch.output === undefined ? undefined : JSON.stringify(patch.output),
    ai_calls: patch.aiCalls,
    tokens: patch.tokens,
  }
  const entries = Object.entries(cols).filter(([, v]) => v !== undefined)
  if (!entries.length) return
  db.prepare(`UPDATE run_steps SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE run_id = ? AND idx = ?`).run(
    ...entries.map(([, v]) => v),
    runId,
    idx,
  )
}

export function getRun(db: DB, runId: number): RunDetail | null {
  const row = db.prepare(`${SUMMARY_SQL} WHERE r.id = ? GROUP BY r.id`).get(runId) as any
  if (!row) return null
  const steps = (db.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY idx').all(runId) as any[]).map(
    (s): StepResult => ({
      index: s.idx,
      type: s.type,
      content: s.content,
      status: s.status,
      durationMs: s.duration_ms,
      error: s.error,
      screenshot: s.screenshot,
      output: s.output == null ? undefined : JSON.parse(s.output),
      aiCalls: s.ai_calls,
      tokens: s.tokens,
    }),
  )
  return { ...toSummary(row), url: row.url, steps, midsceneReport: row.midscene_report, env: row.env_snapshot ? JSON.parse(row.env_snapshot) : null, continueOnFailure: !!row.continue_on_failure }
}

export function listRuns(db: DB, opts: { caseId?: number; batchId?: number; limit?: number } = {}): RunSummary[] {
  const conds: string[] = []
  const params: unknown[] = []
  if (opts.caseId) conds.push('r.case_id = ?'), params.push(opts.caseId)
  if (opts.batchId) conds.push('r.batch_id = ?'), params.push(opts.batchId)
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const rows = db
    .prepare(`${SUMMARY_SQL} ${where} GROUP BY r.id ORDER BY r.id DESC LIMIT ?`)
    .all(...params, opts.limit ?? 50)
  return rows.map(toSummary)
}

/** 平台重启时，上次未跑完的运行标记为 error，避免一直停在“运行中” */
export function failInterruptedRuns(db: DB) {
  db.prepare(`UPDATE run_steps SET status = 'not_run' WHERE status IN ('pending', 'running')
    AND run_id IN (SELECT id FROM runs WHERE status IN ('queued', 'running'))`).run()
  db.prepare(`UPDATE runs SET status = 'error', error = '平台重启，运行被中断' WHERE status IN ('queued', 'running')`).run()
}

/** 运行统计：只统计已结束的运行；通过率 = 通过 / (通过 + 失败 + 异常) */
export function getStats(db: DB, opts: { days?: number; caseId?: number } = {}): Stats {
  const days = opts.days ?? 14
  const filter = `status NOT IN ('queued', 'running')
    AND started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
    ${opts.caseId ? 'AND case_id = ?' : ''}`
  const params: unknown[] = [`-${days} days`, ...(opts.caseId ? [opts.caseId] : [])]

  const t = db
    .prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(status = 'passed'), 0) AS passed,
         COALESCE(SUM(status IN ('failed', 'error')), 0) AS failed,
         COALESCE(AVG(duration_ms), 0) AS avg_ms
       FROM runs WHERE ${filter}`,
    )
    .get(...params) as any
  const usage = db
    .prepare(
      `SELECT COALESCE(SUM(ai_calls), 0) AS calls, COALESCE(SUM(tokens), 0) AS tokens
       FROM run_steps WHERE run_id IN (SELECT id FROM runs WHERE ${filter})`,
    )
    .get(...params) as any
  const daily = (
    db
      .prepare(
        `SELECT date(started_at, 'localtime') AS d, COUNT(*) AS runs,
           SUM(status = 'passed') AS passed, SUM(status IN ('passed', 'failed', 'error')) AS decided,
           AVG(duration_ms) AS avg_ms
         FROM runs WHERE ${filter} GROUP BY d ORDER BY d`,
      )
      .all(...params) as any[]
  ).map(
    (r): DailyStat => ({
      date: r.d,
      runs: r.runs,
      passed: r.passed,
      passRate: r.decided ? r.passed / r.decided : null,
      avgDurationMs: Math.round(r.avg_ms),
    }),
  )
  const decided = t.passed + t.failed
  return {
    totalRuns: t.total,
    passedRuns: t.passed,
    failedRuns: t.failed,
    passRate: decided ? t.passed / decided : null,
    avgDurationMs: Math.round(t.avg_ms),
    aiCalls: usage.calls,
    tokens: usage.tokens,
    daily,
  }
}
