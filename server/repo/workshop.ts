import type {
  BatchCompare,
  BatchStats,
  CaseInput,
  Coverage,
  CoverageRow,
  CoverageStatus,
  DiscardReason,
  Draft,
  GenBatch,
  GenBatchDetail,
  ParseRecord,
  ReqPoint,
  ReqPointInput,
  Requirement,
  RequirementDetail,
  RequirementSummary,
  RunStatus,
  Verdict,
} from '../../shared/types.js'
import { type ParsedPoint, excerptFound, matchPoints, sha256 } from '../ai/workshop.js'
import { editSize, editStats, fisherExact, proportion } from '../ai/stats.js'
import type { DB } from '../db.js'
import { createCase } from './cases.js'

const conflict = (msg: string) => Object.assign(new Error(msg), { statusCode: 409, code: 'CONFLICT' })
const badRequest = (msg: string) => Object.assign(new Error(msg), { statusCode: 400 })

// —— 需求 ——

const toRequirement = (r: any): Requirement => ({
  id: r.id,
  name: r.name,
  version: r.version,
  content: r.content,
  contentHash: r.content_hash,
  targetUrl: r.target_url,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export interface RequirementInput {
  name: string
  content: string
  targetUrl: string
}

export function getRequirement(db: DB, id: number): Requirement | null {
  const r = db.prepare('SELECT * FROM requirements WHERE id = ?').get(id)
  return r ? toRequirement(r) : null
}

export function createRequirement(db: DB, input: RequirementInput): Requirement {
  const info = db
    .prepare('INSERT INTO requirements (name, content, content_hash, target_url) VALUES (?, ?, ?, ?)')
    .run(input.name, input.content, sha256(input.content), input.targetUrl)
  return getRequirement(db, Number(info.lastInsertRowid))!
}

/** 原文有变化时版本号 + 1；已有需求点不动，需要重新解析 */
export function updateRequirement(db: DB, id: number, input: RequirementInput): Requirement | null {
  const old = getRequirement(db, id)
  if (!old) return null
  const hash = sha256(input.content)
  db.prepare(
    `UPDATE requirements SET name = ?, content = ?, content_hash = ?, target_url = ?, version = version + ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(input.name, input.content, hash, input.targetUrl, hash === old.contentHash ? 0 : 1, id)
  return getRequirement(db, id)
}

export function deleteRequirement(db: DB, id: number) {
  return db.prepare('DELETE FROM requirements WHERE id = ?').run(id).changes > 0
}

export function listRequirements(db: DB): RequirementSummary[] {
  const rows = db.prepare('SELECT * FROM requirements ORDER BY id DESC').all() as any[]
  return rows.map((r) => {
    const cov = getCoverage(db, r.id)
    const n = (sql: string) => (db.prepare(sql).get(r.id) as { n: number }).n
    return {
      ...toRequirement(r),
      points: cov.total,
      batches: n('SELECT COUNT(*) AS n FROM gen_batches WHERE requirement_id = ?'),
      pendingDrafts: n(`SELECT COUNT(*) AS n FROM drafts d JOIN gen_batches b ON b.id = d.batch_id WHERE b.requirement_id = ? AND d.verdict = 'pending'`),
      verifiedRate: cov.total ? cov.counts.verified / cov.total : null,
      linkedRate: cov.total ? (cov.total - cov.counts.uncovered) / cov.total : null,
    }
  })
}

export function getRequirementDetail(db: DB, id: number): RequirementDetail | null {
  const req = getRequirement(db, id)
  if (!req) return null
  const parses = (db.prepare('SELECT * FROM parses WHERE requirement_id = ? ORDER BY id DESC').all(id) as any[]).map(toParse)
  return { ...req, points: listPoints(db, id), parses, batches: listGenBatches(db, id) }
}

// —— 需求点 ——

const toPoint = (r: any, content: string): ReqPoint => ({
  id: r.id,
  requirementId: r.requirement_id,
  parseId: r.parse_id,
  code: r.code,
  title: r.title,
  detail: r.detail,
  priority: r.priority,
  sourceExcerpt: r.source_excerpt,
  excerptFound: excerptFound(content, r.source_excerpt),
  status: r.status,
})

export function listPoints(db: DB, requirementId: number, includeRemoved = false): ReqPoint[] {
  const req = getRequirement(db, requirementId)
  if (!req) return []
  const rows = db
    .prepare(`SELECT * FROM req_points WHERE requirement_id = ? ${includeRemoved ? '' : "AND status = 'active'"} ORDER BY code`)
    .all(requirementId) as any[]
  return rows.map((r) => toPoint(r, req.content))
}

/** 下一个需求点编号：取历史最大编号（含已移除的，避免编号复用造成误解）+ 1 */
function nextCodes(db: DB, requirementId: number) {
  const codes = (db.prepare('SELECT code FROM req_points WHERE requirement_id = ?').all(requirementId) as { code: string }[]).map((r) =>
    Number(r.code.replace(/^REQ-/, '')),
  )
  let next = Math.max(0, ...codes.filter(Number.isFinite)) + 1
  return () => `REQ-${String(next++).padStart(3, '0')}`
}

const toParse = (r: any): ParseRecord => ({
  id: r.id,
  requirementId: r.requirement_id,
  requirementVersion: r.requirement_version,
  model: r.model,
  promptVersion: r.prompt_version,
  tokens: r.tokens,
  durationMs: r.duration_ms,
  added: r.added,
  kept: r.kept,
  removed: r.removed,
  createdAt: r.created_at,
})

/**
 * 保存一次解析：与现有 active 需求点按标题匹配，匹配上的沿用编号（用例关联不变）并更新内容；
 * 新的点分配新编号；没匹配上的模型解析点标记为 removed，人工新增的点保留。
 */
export function applyParse(
  db: DB,
  requirementId: number,
  meta: { model: string; promptVersion: string; tokens: number; durationMs: number; rawOutput: string },
  parsed: ParsedPoint[],
): ParseRecord {
  const req = getRequirement(db, requirementId)!
  return db.transaction(() => {
    const parseId = Number(
      db
        .prepare(
          'INSERT INTO parses (requirement_id, requirement_version, model, prompt_version, tokens, duration_ms, raw_output) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(requirementId, req.version, meta.model, meta.promptVersion, meta.tokens, meta.durationMs, meta.rawOutput).lastInsertRowid,
    )
    const existing = db.prepare(`SELECT id, title, parse_id FROM req_points WHERE requirement_id = ? AND status = 'active'`).all(requirementId) as {
      id: number
      title: string
      parse_id: number | null
    }[]
    const matched = matchPoints(parsed, existing)
    const code = nextCodes(db, requirementId)
    const update = db.prepare(
      `UPDATE req_points SET parse_id = ?, title = ?, detail = ?, priority = ?, source_excerpt = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
    const insert = db.prepare(
      'INSERT INTO req_points (requirement_id, parse_id, code, title, detail, priority, source_excerpt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    let added = 0
    parsed.forEach((p, i) => {
      const id = matched.get(i)
      if (id !== undefined) update.run(parseId, p.title, p.detail, p.priority, p.sourceExcerpt, id)
      else {
        insert.run(requirementId, parseId, code(), p.title, p.detail, p.priority, p.sourceExcerpt)
        added++
      }
    })
    const keptIds = new Set(matched.values())
    const stale = existing.filter((e) => !keptIds.has(e.id) && e.parse_id !== null)
    const remove = db.prepare(`UPDATE req_points SET status = 'removed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    stale.forEach((e) => remove.run(e.id))
    db.prepare('UPDATE parses SET added = ?, kept = ?, removed = ? WHERE id = ?').run(added, keptIds.size, stale.length, parseId)
    return toParse(db.prepare('SELECT * FROM parses WHERE id = ?').get(parseId))
  })()
}

/** 人工编辑需求点：带 id 的更新，不带 id 的新增，列表里没有的 active 点标记为 removed */
export function savePoints(db: DB, requirementId: number, inputs: ReqPointInput[]): ReqPoint[] {
  db.transaction(() => {
    const active = new Set(
      (db.prepare(`SELECT id FROM req_points WHERE requirement_id = ? AND status = 'active'`).all(requirementId) as { id: number }[]).map((r) => r.id),
    )
    for (const p of inputs) if (p.id !== undefined && !active.has(p.id)) throw badRequest(`需求点 ${p.id} 不存在或已移除`)
    const code = nextCodes(db, requirementId)
    const update = db.prepare(
      `UPDATE req_points SET title = ?, detail = ?, priority = ?, source_excerpt = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
    const insert = db.prepare('INSERT INTO req_points (requirement_id, code, title, detail, priority, source_excerpt) VALUES (?, ?, ?, ?, ?, ?)')
    const kept = new Set<number>()
    for (const p of inputs) {
      if (p.id !== undefined) {
        update.run(p.title, p.detail, p.priority, p.sourceExcerpt, p.id)
        kept.add(p.id)
      } else insert.run(requirementId, code(), p.title, p.detail, p.priority, p.sourceExcerpt)
    }
    const remove = db.prepare(`UPDATE req_points SET status = 'removed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    for (const id of active) if (!kept.has(id)) remove.run(id)
  })()
  return listPoints(db, requirementId)
}

// —— 生成批次与草稿 ——

export interface NewDraft {
  name: string
  description: string
  url: string
  steps: CaseInput['steps']
  pointIds: number[]
  confidence: number | null
}

export function createGenBatch(
  db: DB,
  meta: { requirementId: number; parseId: number | null; scope: number[]; model: string; promptVersion: string; inputHash: string; tokens: number; durationMs: number; rawOutput: string },
  drafts: NewDraft[],
): GenBatchDetail {
  const id = db.transaction(() => {
    const batchId = Number(
      db
        .prepare(
          `INSERT INTO gen_batches (requirement_id, parse_id, scope, model, prompt_version, input_hash, tokens, duration_ms, raw_output)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(meta.requirementId, meta.parseId, JSON.stringify(meta.scope), meta.model, meta.promptVersion, meta.inputHash, meta.tokens, meta.durationMs, meta.rawOutput)
        .lastInsertRowid,
    )
    const ins = db.prepare('INSERT INTO drafts (batch_id, name, description, url, steps, point_ids, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const d of drafts) ins.run(batchId, d.name, d.description, d.url, JSON.stringify(d.steps), JSON.stringify(d.pointIds), d.confidence)
    return batchId
  })()
  return getGenBatch(db, id)!
}

const toDraft = (r: any): Draft => ({
  id: r.id,
  batchId: r.batch_id,
  name: r.name,
  description: r.description,
  url: r.url,
  steps: JSON.parse(r.steps),
  pointIds: JSON.parse(r.point_ids),
  confidence: r.confidence,
  verdict: r.verdict,
  discardReason: r.discard_reason,
  final: r.final ? JSON.parse(r.final) : null,
  editStats: r.edit_stats ? JSON.parse(r.edit_stats) : null,
  note: r.note,
  reviewedAt: r.reviewed_at,
  caseId: r.case_id,
})

export function getDraft(db: DB, id: number): Draft | null {
  const r = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id)
  return r ? toDraft(r) : null
}

function toBatch(db: DB, r: any): GenBatch {
  const seq = (db.prepare('SELECT COUNT(*) AS n FROM gen_batches WHERE requirement_id = ? AND id <= ?').get(r.requirement_id, r.id) as { n: number }).n
  return {
    id: r.id,
    seq,
    requirementId: r.requirement_id,
    parseId: r.parse_id,
    scope: JSON.parse(r.scope),
    model: r.model,
    promptVersion: r.prompt_version,
    inputHash: r.input_hash,
    tokens: r.tokens,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    stats: batchStats(db, r.id, r.requirement_id, r.tokens),
  }
}

export function listGenBatches(db: DB, requirementId: number): GenBatch[] {
  return (db.prepare('SELECT * FROM gen_batches WHERE requirement_id = ? ORDER BY id DESC').all(requirementId) as any[]).map((r) => toBatch(db, r))
}

export function getGenBatch(db: DB, id: number): GenBatchDetail | null {
  const r = db.prepare('SELECT * FROM gen_batches WHERE id = ?').get(id) as any
  if (!r) return null
  const drafts = (db.prepare('SELECT * FROM drafts WHERE batch_id = ? ORDER BY id').all(id) as any[]).map(toDraft)
  return { ...toBatch(db, r), drafts, points: listPoints(db, r.requirement_id, true) }
}

/** 某批次（或更早的批次）入库用例关联到的需求点 */
function pointsLinkedByBatches(db: DB, requirementId: number, upToBatchId: number, onlyThis = false) {
  const rows = db
    .prepare(
      `SELECT DISTINCT cp.point_id AS id FROM case_points cp
         JOIN cases c ON c.id = cp.case_id
         JOIN drafts d ON d.id = c.source_draft_id
         JOIN gen_batches b ON b.id = d.batch_id
       WHERE b.requirement_id = ? AND ${onlyThis ? 'b.id = ?' : 'b.id <= ?'}`,
    )
    .all(requirementId, upToBatchId) as { id: number }[]
  return new Set(rows.map((r) => r.id))
}

/** 结论性运行：无变更注入，且已通过 / 失败 / 异常（排除跳过和未结束的） */
const CONCLUSIVE = `mutation = 'none' AND status IN ('passed', 'failed', 'error')`

export function batchStats(db: DB, batchId: number, requirementId: number, tokens: number): BatchStats {
  const drafts = (db.prepare('SELECT verdict, discard_reason, edit_stats, case_id FROM drafts WHERE batch_id = ?').all(batchId) as any[])
  const count = (v: Verdict) => drafts.filter((d) => d.verdict === v).length
  const accepted = count('accepted')
  const edited = count('edited')
  const discarded = count('discarded')
  const reviewed = accepted + edited + discarded
  const reasons = { duplicate: 0, out_of_scope: 0, not_executable: 0, vague_assert: 0, low_value: 0, other: 0 } as Record<DiscardReason, number>
  for (const d of drafts) if (d.verdict === 'discarded' && d.discard_reason in reasons) reasons[d.discard_reason as DiscardReason]++
  const editSizes = drafts.filter((d) => d.verdict === 'edited' && d.edit_stats).map((d) => editSize(JSON.parse(d.edit_stats)))

  const caseIds = drafts.map((d) => d.case_id).filter((x): x is number => x !== null)
  let firstPassed = 0
  let firstTotal = 0
  const firstRun = db.prepare(`SELECT status FROM runs WHERE case_id = ? AND ${CONCLUSIVE} ORDER BY id LIMIT 1`)
  for (const id of caseIds) {
    const r = firstRun.get(id) as { status: RunStatus } | undefined
    if (!r) continue
    firstTotal++
    if (r.status === 'passed') firstPassed++
  }

  const before = pointsLinkedByBatches(db, requirementId, batchId - 1)
  const mine = pointsLinkedByBatches(db, requirementId, batchId, true)
  const adopted = accepted + edited
  return {
    total: drafts.length,
    reviewed,
    accepted,
    edited,
    discarded,
    adoption: proportion(adopted, reviewed),
    direct: proportion(accepted, reviewed),
    avgEditedSteps: editSizes.length ? editSizes.reduce((a, b) => a + b, 0) / editSizes.length : null,
    reasons,
    firstRun: proportion(firstPassed, firstTotal),
    newlyLinked: [...mine].filter((id) => !before.has(id)).length,
    tokensPerAdopted: adopted ? Math.round(tokens / adopted) : null,
  }
}

// —— 审核 ——

export interface ReviewInput {
  verdict: Exclude<Verdict, 'pending'>
  /** 修改后通过时的终稿 */
  final?: CaseInput
  /** 关联的需求点；不传则沿用原稿 */
  pointIds?: number[]
  reason?: DiscardReason
  note?: string
}

/** 审核一条草稿：通过 / 修改后通过时入库并关联需求点；修改后与原稿完全一致的按“通过”记 */
export function reviewDraft(db: DB, draftId: number, input: ReviewInput): Draft | null {
  return db.transaction(() => {
    const draft = getDraft(db, draftId)
    if (!draft) return null
    if (draft.verdict !== 'pending') throw conflict('这条草稿已经审核过了')
    const batch = db.prepare('SELECT requirement_id FROM gen_batches WHERE id = ?').get(draft.batchId) as { requirement_id: number }
    const note = input.note?.trim() ?? ''

    if (input.verdict === 'discarded') {
      if (!input.reason) throw badRequest('废弃时必须选择原因')
      if (input.reason === 'other' && !note) throw badRequest('原因选“其他”时请填写备注')
      db.prepare(
        `UPDATE drafts SET verdict = 'discarded', discard_reason = ?, note = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(input.reason, note, draftId)
      return getDraft(db, draftId)
    }

    const pointIds = [...new Set(input.pointIds ?? draft.pointIds)]
    if (!pointIds.length) throw badRequest('入库的用例至少要关联一个需求点')
    const valid = new Set(listPoints(db, batch.requirement_id).map((p) => p.id))
    const bad = pointIds.find((id) => !valid.has(id))
    if (bad !== undefined) throw badRequest(`需求点 ${bad} 不属于这个需求或已被移除`)

    const original: CaseInput = { name: draft.name, description: draft.description, url: draft.url, steps: draft.steps }
    const final = input.verdict === 'edited' && input.final ? input.final : original
    const stats = editStats(original, final)
    const unchanged =
      editSize(stats) === 0 &&
      !stats.nameChanged &&
      final.description.trim() === original.description.trim() &&
      final.url === original.url &&
      [...pointIds].sort().join() === [...draft.pointIds].sort().join()
    const verdict: Verdict = input.verdict === 'edited' && !unchanged ? 'edited' : 'accepted'

    const tc = createCase(db, final)
    db.prepare('UPDATE cases SET source_draft_id = ? WHERE id = ?').run(draftId, tc.id)
    const link = db.prepare('INSERT INTO case_points (case_id, point_id) VALUES (?, ?)')
    pointIds.forEach((pid) => link.run(tc.id, pid))
    db.prepare(
      `UPDATE drafts SET verdict = ?, final = ?, edit_stats = ?, note = ?, case_id = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ).run(verdict, JSON.stringify({ ...final, pointIds }), verdict === 'edited' ? JSON.stringify(stats) : null, note, tc.id, draftId)
    return getDraft(db, draftId)
  })()
}

// —— 覆盖矩阵 ——

export function getCoverage(db: DB, requirementId: number): Coverage {
  const points = listPoints(db, requirementId)
  const links = db
    .prepare(
      `SELECT cp.point_id, c.id, c.name FROM case_points cp JOIN cases c ON c.id = cp.case_id
       JOIN req_points p ON p.id = cp.point_id WHERE p.requirement_id = ? ORDER BY c.id`,
    )
    .all(requirementId) as { point_id: number; id: number; name: string }[]
  const lastRun = db.prepare(`SELECT id, status FROM runs WHERE case_id = ? AND ${CONCLUSIVE} ORDER BY id DESC LIMIT 1`)
  const lastByCase = new Map<number, { id: number; status: RunStatus } | undefined>()
  const last = (caseId: number) => {
    if (!lastByCase.has(caseId)) lastByCase.set(caseId, lastRun.get(caseId) as { id: number; status: RunStatus } | undefined)
    return lastByCase.get(caseId)
  }

  const counts: Record<CoverageStatus, number> = { uncovered: 0, linked: 0, verified: 0, failed: 0 }
  const rows: CoverageRow[] = points.map((point) => {
    const cases = links
      .filter((l) => l.point_id === point.id)
      .map((l) => ({ id: l.id, name: l.name, lastStatus: last(l.id)?.status ?? null, lastRunId: last(l.id)?.id ?? null }))
    const status: CoverageStatus = !cases.length
      ? 'uncovered'
      : cases.some((c) => c.lastStatus === 'passed')
        ? 'verified'
        : cases.every((c) => c.lastStatus !== null)
          ? 'failed'
          : 'linked'
    counts[status]++
    return { point, status, cases }
  })

  const active = new Set(points.map((p) => p.id))
  const batches = db.prepare('SELECT id, prompt_version FROM gen_batches WHERE requirement_id = ? ORDER BY id').all(requirementId) as {
    id: number
    prompt_version: string
  }[]
  const timeline = batches.map((b, i) => {
    const linked = [...pointsLinkedByBatches(db, requirementId, b.id)].filter((id) => active.has(id)).length
    return { batchId: b.id, seq: i + 1, promptVersion: b.prompt_version, linked, rate: points.length ? linked / points.length : 0 }
  })

  return {
    requirementId,
    total: points.length,
    counts,
    p0Uncovered: rows.filter((r) => r.status === 'uncovered' && r.point.priority === 'P0').map((r) => r.point),
    rows,
    timeline,
  }
}

export function coverageCsv(cov: Coverage) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const LABEL: Record<CoverageStatus, string> = { uncovered: '未覆盖', linked: '已关联·未执行', verified: '已验证', failed: '失败' }
  const lines = [['编号', '需求点', '优先级', '覆盖状态', '关联用例', '原文摘录'].join(',')]
  for (const r of cov.rows) {
    lines.push(
      [r.point.code, r.point.title, r.point.priority, LABEL[r.status], r.cases.map((c) => `#${c.id} ${c.name}（${c.lastStatus ?? '未运行'}）`).join('；'), r.point.sourceExcerpt]
        .map(esc)
        .join(','),
    )
  }
  return '﻿' + lines.join('\n') + '\n' // BOM：Excel 打开不乱码
}

// —— 批次对比 ——

export function compareBatches(db: DB, aId: number, bId: number): BatchCompare | null {
  const ra = db.prepare('SELECT * FROM gen_batches WHERE id = ?').get(aId) as any
  const rb = db.prepare('SELECT * FROM gen_batches WHERE id = ?').get(bId) as any
  if (!ra || !rb) return null
  const a = toBatch(db, ra)
  const b = toBatch(db, rb)
  const same = (x: number[], y: number[]) => [...x].sort().join() === [...y].sort().join()
  return {
    a,
    b,
    sameScope: a.requirementId === b.requirementId && same(a.scope, b.scope),
    adoptionPValue: fisherExact(a.stats.adoption.k, a.stats.adoption.n, b.stats.adoption.k, b.stats.adoption.n),
    enoughSamples: a.stats.reviewed >= 20 && b.stats.reviewed >= 20,
  }
}

/** 某批次已入库的用例 id（用于“运行本批入库用例”） */
export function batchCaseIds(db: DB, batchId: number): number[] {
  return (db.prepare('SELECT case_id FROM drafts WHERE batch_id = ? AND case_id IS NOT NULL ORDER BY id').all(batchId) as { case_id: number }[]).map(
    (r) => r.case_id,
  )
}
