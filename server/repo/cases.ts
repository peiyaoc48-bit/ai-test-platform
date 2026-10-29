import type { CaseInput, RunSummary, TestCase } from '../../shared/types.js'
import type { DB } from '../db.js'
import { rowToSummary } from './runs.js'

interface CaseRow {
  id: number
  name: string
  description: string
  url: string
  steps: string
  created_at: string
  updated_at: string
}

const toCase = (r: CaseRow): TestCase => ({
  id: r.id,
  name: r.name,
  description: r.description,
  url: r.url,
  steps: JSON.parse(r.steps),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listCases(db: DB): TestCase[] {
  const rows = db.prepare('SELECT * FROM cases ORDER BY id DESC').all() as CaseRow[]
  // 每个用例最近一次运行
  const last = db
    .prepare(`SELECT * FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY case_id)`)
    .all() as any[]
  const lastByCase = new Map<number, RunSummary>()
  for (const r of last) lastByCase.set(r.case_id, rowToSummary(db, r))
  return rows.map((r) => ({ ...toCase(r), lastRun: lastByCase.get(r.id) ?? null }))
}

export function getCase(db: DB, id: number): TestCase | null {
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow | undefined
  return row ? toCase(row) : null
}

export function createCase(db: DB, input: CaseInput): TestCase {
  const info = db
    .prepare('INSERT INTO cases (name, description, url, steps) VALUES (?, ?, ?, ?)')
    .run(input.name, input.description, input.url, JSON.stringify(input.steps))
  return getCase(db, Number(info.lastInsertRowid))!
}

export function updateCase(db: DB, id: number, input: CaseInput): TestCase | null {
  const info = db
    .prepare(
      `UPDATE cases SET name = ?, description = ?, url = ?, steps = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
    .run(input.name, input.description, input.url, JSON.stringify(input.steps), id)
  return info.changes ? getCase(db, id) : null
}

export function deleteCase(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM cases WHERE id = ?').run(id).changes > 0
}

export function countCases(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM cases').get() as { n: number }).n
}
