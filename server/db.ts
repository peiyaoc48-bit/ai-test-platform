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

-- —— 用例工坊 ——
-- 需求文档：修改原文时 version + 1，解析记录里保存当时的版本
CREATE TABLE IF NOT EXISTS requirements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  target_url   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 一次解析（需求文档 → 需求点），保留模型原始输出便于排查
CREATE TABLE IF NOT EXISTS parses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id      INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  requirement_version INTEGER NOT NULL,
  model               TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  tokens              INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  added               INTEGER NOT NULL DEFAULT 0,
  kept                INTEGER NOT NULL DEFAULT 0,
  removed             INTEGER NOT NULL DEFAULT 0,
  raw_output          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 需求点：重新解析时按标题相似度沿用旧行（编号与用例关联不变），没匹配上的标记为 removed
CREATE TABLE IF NOT EXISTS req_points (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  parse_id       INTEGER REFERENCES parses(id) ON DELETE SET NULL,
  code           TEXT NOT NULL,
  title          TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  priority       TEXT NOT NULL DEFAULT 'P1',
  source_excerpt TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (requirement_id, code)
);

-- 一次生成：scope 为本批针对的需求点；input_hash = Prompt 版本 + 需求点内容，相同表示输入可比
CREATE TABLE IF NOT EXISTS gen_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  parse_id       INTEGER REFERENCES parses(id) ON DELETE SET NULL,
  scope          TEXT NOT NULL,             -- JSON: number[]
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash     TEXT NOT NULL,
  tokens         INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  raw_output     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 草稿：原稿（name/description/url/steps/point_ids）生成后不再修改，终稿另存在 final
CREATE TABLE IF NOT EXISTS drafts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id       INTEGER NOT NULL REFERENCES gen_batches(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL,
  steps          TEXT NOT NULL,             -- JSON: Step[]
  point_ids      TEXT NOT NULL DEFAULT '[]',
  confidence     REAL,
  verdict        TEXT NOT NULL DEFAULT 'pending',
  discard_reason TEXT,
  final          TEXT,                      -- JSON: CaseInput & { pointIds }
  edit_stats     TEXT,                      -- JSON: EditStats
  note           TEXT NOT NULL DEFAULT '',
  reviewed_at    TEXT,
  case_id        INTEGER REFERENCES cases(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_batch ON drafts(batch_id);

-- 用例 ↔ 需求点
CREATE TABLE IF NOT EXISTS case_points (
  case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  point_id INTEGER NOT NULL REFERENCES req_points(id) ON DELETE CASCADE,
  PRIMARY KEY (case_id, point_id)
);
CREATE INDEX IF NOT EXISTS idx_case_points_point ON case_points(point_id);

-- 探索模式（M1：只采集，不标注）
CREATE TABLE IF NOT EXISTS kb_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  base_url      TEXT NOT NULL,
  config        TEXT NOT NULL,             -- JSON，预置登录动作里的值已替换为 ***
  status        TEXT NOT NULL DEFAULT 'running',  -- running | done | failed
  stop_reason   TEXT,
  error         TEXT,
  clicks        INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at   TEXT
);
CREATE TABLE IF NOT EXISTS kb_states (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES kb_runs(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  url_pattern   TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  depth         INTEGER NOT NULL,
  reproducible  INTEGER NOT NULL DEFAULT 1,
  path          TEXT NOT NULL,             -- JSON: 从起点到该状态的动作
  UNIQUE (run_id, idx)
);
CREATE TABLE IF NOT EXISTS kb_elements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES kb_runs(id) ON DELETE CASCADE,
  element_key   TEXT NOT NULL,
  role          TEXT NOT NULL,
  name          TEXT NOT NULL,
  selector      TEXT NOT NULL,
  tag           TEXT NOT NULL,
  input_type    TEXT,
  danger        TEXT,                      -- keyword | logout | NULL
  clicked       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (run_id, element_key)
);
CREATE TABLE IF NOT EXISTS kb_occurrences (
  element_id    INTEGER NOT NULL REFERENCES kb_elements(id) ON DELETE CASCADE,
  state_id      INTEGER NOT NULL REFERENCES kb_states(id) ON DELETE CASCADE,
  count         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (element_id, state_id)
);
CREATE TABLE IF NOT EXISTS kb_transitions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES kb_runs(id) ON DELETE CASCADE,
  from_state_id INTEGER NOT NULL REFERENCES kb_states(id) ON DELETE CASCADE,
  element_id    INTEGER NOT NULL REFERENCES kb_elements(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  to_state_id   INTEGER NOT NULL REFERENCES kb_states(id) ON DELETE CASCADE,
  effect        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kb_blocked (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES kb_runs(id) ON DELETE CASCADE,
  state_id      INTEGER REFERENCES kb_states(id) ON DELETE SET NULL,
  url           TEXT NOT NULL,             -- 已去掉查询参数的值
  method        TEXT NOT NULL,
  reason        TEXT NOT NULL              -- host | write
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
  // 变更注入（none / attr / style）与“失败后继续执行”（鲁棒性对比时逐步统计）
  if (!cols.includes('mutation')) db.exec("ALTER TABLE runs ADD COLUMN mutation TEXT NOT NULL DEFAULT 'none'")
  if (!cols.includes('continue_on_failure')) db.exec('ALTER TABLE runs ADD COLUMN continue_on_failure INTEGER NOT NULL DEFAULT 0')
  const stepCols = (db.prepare('PRAGMA table_info(run_steps)').all() as { name: string }[]).map((c) => c.name)
  if (!stepCols.includes('fallback')) db.exec('ALTER TABLE run_steps ADD COLUMN fallback TEXT')
  const batchCols = (db.prepare('PRAGMA table_info(batches)').all() as { name: string }[]).map((c) => c.name)
  if (!batchCols.includes('kind')) db.exec("ALTER TABLE batches ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal'")
  const suiteCols = (db.prepare('PRAGMA table_info(suites)').all() as { name: string }[]).map((c) => c.name)
  if (!suiteCols.includes('env_id')) db.exec('ALTER TABLE suites ADD COLUMN env_id INTEGER REFERENCES environments(id) ON DELETE SET NULL')
  db.exec('CREATE INDEX IF NOT EXISTS idx_runs_batch ON runs(batch_id)')
  // 用例工坊入库的用例记录来源草稿（手写用例为空）
  const caseCols = (db.prepare('PRAGMA table_info(cases)').all() as { name: string }[]).map((c) => c.name)
  if (!caseCols.includes('source_draft_id')) db.exec('ALTER TABLE cases ADD COLUMN source_draft_id INTEGER REFERENCES drafts(id) ON DELETE SET NULL')
}
