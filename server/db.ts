import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export type DB = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  steps       TEXT NOT NULL,              -- JSON: Step[]
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  case_name       TEXT NOT NULL,           -- 冗余保存，用例改名后历史报告仍可读
  url             TEXT NOT NULL,
  status          TEXT NOT NULL,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at      TEXT,
  finished_at     TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  midscene_report TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_case ON runs(case_id, id);

CREATE TABLE IF NOT EXISTS run_steps (
  run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  screenshot  TEXT,
  output      TEXT,                        -- JSON
  ai_calls    INTEGER NOT NULL DEFAULT 0,
  tokens      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, idx)
);
`

/** file 传 ':memory:' 用于单元测试 */
export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
