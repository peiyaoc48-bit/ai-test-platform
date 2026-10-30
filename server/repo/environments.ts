import type { EnvSnapshot, Environment, EnvironmentInput } from '../../shared/types.js'
import type { DB } from '../db.js'

const toEnv = (r: any): Environment => ({
  id: r.id,
  name: r.name,
  description: r.description,
  baseUrl: r.base_url,
  vars: JSON.parse(r.vars),
  launchArgs: JSON.parse(r.launch_args),
  permissions: JSON.parse(r.permissions),
  localStorage: JSON.parse(r.local_storage),
  stepTimeoutMs: r.step_timeout_ms,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const cols = (e: EnvironmentInput) => [
  e.name,
  e.description,
  e.baseUrl,
  JSON.stringify(e.vars),
  JSON.stringify(e.launchArgs),
  JSON.stringify(e.permissions),
  JSON.stringify(e.localStorage),
  e.stepTimeoutMs,
]

export function listEnvironments(db: DB): Environment[] {
  return (db.prepare('SELECT * FROM environments ORDER BY id').all() as any[]).map(toEnv)
}

export function getEnvironment(db: DB, id: number): Environment | null {
  const r = db.prepare('SELECT * FROM environments WHERE id = ?').get(id)
  return r ? toEnv(r) : null
}

export function createEnvironment(db: DB, e: EnvironmentInput): Environment {
  const info = db
    .prepare(
      `INSERT INTO environments (name, description, base_url, vars, launch_args, permissions, local_storage, step_timeout_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...cols(e))
  return getEnvironment(db, Number(info.lastInsertRowid))!
}

export function updateEnvironment(db: DB, id: number, e: EnvironmentInput): Environment | null {
  const info = db
    .prepare(
      `UPDATE environments SET name = ?, description = ?, base_url = ?, vars = ?, launch_args = ?, permissions = ?,
         local_storage = ?, step_timeout_ms = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
    .run(...cols(e), id)
  return info.changes ? getEnvironment(db, id) : null
}

export function deleteEnvironment(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM environments WHERE id = ?').run(id).changes > 0
}

export function snapshot(e: Environment): EnvSnapshot {
  const { createdAt, updatedAt, ...rest } = e
  return rest
}
