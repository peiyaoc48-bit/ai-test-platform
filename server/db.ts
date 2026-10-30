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

CREATE TABLE IF NOT EXISTS environments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  base_url        TEXT NOT NULL DEFAULT '',
  vars            TEXT NOT NULL DEFAULT '{}',   -- JSON
  launch_args     TEXT NOT NULL DEFAULT '[]',   -- JSON
  permissions     TEXT NOT NULL DEFAULT '[]',   -- JSON
  local_storage   TEXT NOT NULL DEFAULT '{}',   -- JSON
  step_timeout_ms INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS suites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  case_ids    TEXT NOT NULL,              -- JSON: number[]，按执行顺序
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 一次批量执行（用例集运行或勾选多个用例运行），包含多条 runs
CREATE TABLE IF NOT EXISTS batches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id   INTEGER REFERENCES suites(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  trigger    TEXT NOT NULL DEFAULT 'manual', -- manual / ci
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

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
  migrate(db)
  return db
}

/** 旧库升级：按需补列，已存在则跳过 */
function migrate(db: DB) {
  const cols = (db.prepare('PRAGMA table_info(runs)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('batch_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL')
  }
  // 运行时的环境快照（JSON），环境被修改或删除后历史报告仍可追溯
  if (!cols.includes('env_snapshot')) db.exec('ALTER TABLE runs ADD COLUMN env_snapshot TEXT')
  const suiteCols = (db.prepare('PRAGMA table_info(suites)').all() as { name: string }[]).map((c) => c.name)
  if (!suiteCols.includes('env_id')) db.exec('ALTER TABLE suites ADD COLUMN env_id INTEGER REFERENCES environments(id) ON DELETE SET NULL')
  db.exec('CREATE INDEX IF NOT EXISTS idx_runs_batch ON runs(batch_id)')
}
