import type { ExploreBlocked, ExploreElement, ExploreRunDetail, ExploreRunSummary, ExploreState, ExploreTransition } from '../../shared/types.js'
import type { DB } from '../db.js'
import type { ExploreConfig, ExploreResult } from '../explore/explorer.js'

/** 预置登录动作里的值不落盘 */
export function redactConfig(cfg: ExploreConfig) {
  return { ...cfg, setup: cfg.setup?.map((s) => (s.type === 'fill' ? { ...s, value: '***' } : s)) }
}

export function createExploreRun(db: DB, cfg: ExploreConfig): number {
  return Number(db.prepare('INSERT INTO kb_runs (base_url, config) VALUES (?, ?)').run(cfg.baseUrl, JSON.stringify(redactConfig(cfg))).lastInsertRowid)
}

export function failExploreRun(db: DB, id: number, error: string) {
  db.prepare("UPDATE kb_runs SET status = 'failed', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(error.slice(0, 500), id)
}

/** 服务重启时，把遗留的“进行中”探索标为失败 */
export function failStaleExploreRuns(db: DB) {
  db.prepare("UPDATE kb_runs SET status = 'failed', error = '服务重启，探索被中断', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'running'").run()
}

export function saveExploreResult(db: DB, runId: number, r: ExploreResult) {
  db.transaction(() => {
    const stateId = new Map<number, number>()
    const insState = db.prepare('INSERT INTO kb_states (run_id, idx, url_pattern, fingerprint, title, depth, reproducible, path) VALUES (?,?,?,?,?,?,?,?)')
    for (const s of r.states)
      stateId.set(s.idx, Number(insState.run(runId, s.idx, s.urlPattern, s.fingerprint, s.title, s.depth, s.reproducible ? 1 : 0, JSON.stringify(s.path.map(({ kind, selector }) => ({ kind, selector })))).lastInsertRowid))

    const elId = new Map<string, number>()
    const insEl = db.prepare('INSERT INTO kb_elements (run_id, element_key, role, name, selector, tag, input_type, danger, clicked) VALUES (?,?,?,?,?,?,?,?,?)')
    for (const e of r.elements) elId.set(e.key, Number(insEl.run(runId, e.key, e.role, e.name.slice(0, 120), e.selector, e.tag, e.inputType, e.danger, e.clicked ? 1 : 0).lastInsertRowid))

    const insOcc = db.prepare('INSERT OR IGNORE INTO kb_occurrences (element_id, state_id, count) VALUES (?,?,?)')
    for (const o of r.occurrences) insOcc.run(elId.get(o.elementKey)!, stateId.get(o.state)!, o.count)

    const insTr = db.prepare('INSERT INTO kb_transitions (run_id, from_state_id, element_id, action, to_state_id, effect) VALUES (?,?,?,?,?,?)')
    for (const t of r.transitions) insTr.run(runId, stateId.get(t.from)!, elId.get(t.elementKey)!, t.action, stateId.get(t.to)!, t.effect)

    const insBl = db.prepare('INSERT INTO kb_blocked (run_id, state_id, url, method, reason) VALUES (?,?,?,?,?)')
    for (const b of r.blocked) insBl.run(runId, stateId.get(b.state) ?? null, b.url, b.method, b.reason)

    db.prepare("UPDATE kb_runs SET status = 'done', stop_reason = ?, clicks = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(r.stopReason, r.clicks, runId)
  })()
}

const SUMMARY_SQL = `
  SELECT r.id, r.base_url AS baseUrl, r.status, r.stop_reason AS stopReason, r.error, r.clicks, r.started_at AS startedAt, r.finished_at AS finishedAt,
    (SELECT COUNT(*) FROM kb_states WHERE run_id = r.id) AS stateCount,
    (SELECT COUNT(*) FROM kb_elements WHERE run_id = r.id) AS elementCount,
    (SELECT COUNT(*) FROM kb_elements WHERE run_id = r.id AND danger IS NOT NULL) AS dangerSkipped,
    (SELECT COUNT(*) FROM kb_blocked WHERE run_id = r.id) AS blockedCount
  FROM kb_runs r`

export const listExploreRuns = (db: DB) => db.prepare(`${SUMMARY_SQL} ORDER BY r.id DESC`).all() as ExploreRunSummary[]

export function getExploreRun(db: DB, id: number): ExploreRunDetail | undefined {
  const summary = db.prepare(`${SUMMARY_SQL} WHERE r.id = ?`).get(id) as ExploreRunSummary | undefined
  if (!summary) return undefined
  const config = JSON.parse((db.prepare('SELECT config FROM kb_runs WHERE id = ?').get(id) as { config: string }).config)
  const states = (db.prepare('SELECT id, idx, url_pattern AS urlPattern, title, depth, reproducible FROM kb_states WHERE run_id = ? ORDER BY idx').all(id) as any[]).map(
    (s): ExploreState => ({ ...s, reproducible: !!s.reproducible }),
  )
  const occ = db.prepare('SELECT o.element_id AS elementId, o.state_id AS stateId FROM kb_occurrences o JOIN kb_elements e ON e.id = o.element_id WHERE e.run_id = ?').all(id) as { elementId: number; stateId: number }[]
  const elements = (db.prepare('SELECT id, element_key AS key, role, name, selector, danger, clicked FROM kb_elements WHERE run_id = ? ORDER BY id').all(id) as any[]).map(
    (e): ExploreElement => ({ ...e, clicked: !!e.clicked, stateIds: occ.filter((o) => o.elementId === e.id).map((o) => o.stateId) }),
  )
  const transitions = db
    .prepare('SELECT from_state_id AS fromStateId, to_state_id AS toStateId, element_id AS elementId, action, effect FROM kb_transitions WHERE run_id = ? ORDER BY id')
    .all(id) as ExploreTransition[]
  const blocked = db.prepare('SELECT state_id AS stateId, url, method, reason FROM kb_blocked WHERE run_id = ? ORDER BY id').all(id) as ExploreBlocked[]
  return { ...summary, config, states, elements, transitions, blocked }
}
