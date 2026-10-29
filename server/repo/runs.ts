import type { RunDetail, RunStatus, RunSummary, StepResult, TestCase } from '../../shared/types.js'
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

export function createRun(db: DB, tc: TestCase, resolvedUrl: string): number {
  const insertRun = db.prepare(`INSERT INTO runs (case_id, case_name, url, status) VALUES (?, ?, ?, 'queued')`)
  const insertStep = db.prepare(`INSERT INTO run_steps (run_id, idx, type, content, status) VALUES (?, ?, ?, ?, 'pending')`)
  return db.transaction(() => {
    const runId = Number(insertRun.run(tc.id, tc.name, resolvedUrl).lastInsertRowid)
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
  return { ...toSummary(row), url: row.url, steps, midsceneReport: row.midscene_report }
}

export function listRuns(db: DB, opts: { caseId?: number; limit?: number } = {}): RunSummary[] {
  const where = opts.caseId ? 'WHERE r.case_id = ?' : ''
  const params = opts.caseId ? [opts.caseId] : []
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
