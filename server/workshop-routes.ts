// 用例工坊的接口：需求 → 解析需求点 → 生成批次 → 审核草稿 → 覆盖矩阵
import type { FastifyInstance } from 'fastify'
import type { DiscardReason, Priority, ReqPointInput } from '../shared/types.js'
import { modelConfig } from './config.js'
import type { DB } from './db.js'
import { buildGenMessages, buildParseMessages, callModel, genInputHash, listPrompts, parseGenDrafts, parsePoints, readPrompt } from './ai/workshop.js'
import {
  applyParse,
  batchCaseIds,
  compareBatches,
  coverageCsv,
  createGenBatch,
  createRequirement,
  deleteRequirement,
  getCoverage,
  getGenBatch,
  getRequirement,
  getRequirementDetail,
  listPoints,
  listRequirements,
  type RequirementInput,
  reviewDraft,
  savePoints,
  updateRequirement,
} from './repo/workshop.js'
import { isValidTargetUrl, validateCase, ValidationError } from './validate.js'

export interface WorkshopDeps {
  db: DB
  fetchImpl?: typeof fetch
  idParam: (req: { params: unknown }) => number
  notFound: (what: string) => Error
  /** 复用平台的批量运行（用例集运行同一套逻辑） */
  startBatch: (name: string, caseIds: number[]) => { batchId: number; runIds: number[] }
}

const MAX_CONTENT = 20_000
/** 一个批次最多针对的需求点数：太多时模型输出会被截断 */
export const MAX_SCOPE = 40
const PRIORITIES: Priority[] = ['P0', 'P1', 'P2']
const REASONS: DiscardReason[] = ['duplicate', 'out_of_scope', 'not_executable', 'vague_assert', 'low_value', 'other']

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function validateRequirement(body: unknown): RequirementInput {
  const b = (body ?? {}) as Record<string, unknown>
  const name = str(b.name)
  if (!name) throw new ValidationError('需求名称不能为空')
  if (name.length > 100) throw new ValidationError('需求名称不能超过 100 个字符')
  const content = str(b.content)
  if (content.length < 20) throw new ValidationError('需求原文太短，请至少写 20 个字')
  if (content.length > MAX_CONTENT) throw new ValidationError(`需求原文不能超过 ${MAX_CONTENT} 字`)
  const targetUrl = str(b.targetUrl) || '{{DEMO}}/index.html'
  if (!isValidTargetUrl(targetUrl)) throw new ValidationError('目标 URL 需以 http:// 或 https:// 开头，或使用 {{DEMO}} 等占位符')
  return { name, content, targetUrl }
}

export function validatePoints(body: unknown): ReqPointInput[] {
  const list = (body as { points?: unknown })?.points
  if (!Array.isArray(list)) throw new ValidationError('points 必须是数组')
  if (list.length > 200) throw new ValidationError('需求点不能超过 200 个')
  return list.map((p: any, i) => {
    const title = str(p?.title)
    if (!title) throw new ValidationError(`第 ${i + 1} 个需求点的标题不能为空`)
    if (title.length > 200) throw new ValidationError(`第 ${i + 1} 个需求点的标题不能超过 200 个字符`)
    if (!PRIORITIES.includes(p.priority)) throw new ValidationError(`第 ${i + 1} 个需求点的优先级只能是 P0 / P1 / P2`)
    const id = p.id === undefined || p.id === null ? undefined : Number(p.id)
    if (id !== undefined && (!Number.isInteger(id) || id <= 0)) throw new ValidationError(`第 ${i + 1} 个需求点的 id 不合法`)
    return { id, title, detail: str(p.detail).slice(0, 1000), priority: p.priority, sourceExcerpt: str(p.sourceExcerpt).slice(0, 500) }
  })
}

function genConfig() {
  const m = modelConfig()
  return { configured: m.configured, baseUrl: m.baseUrl, apiKey: m.apiKey, model: m.genModel, timeoutMs: m.timeoutMs }
}

export function registerWorkshop(app: FastifyInstance, deps: WorkshopDeps) {
  const { db, idParam, notFound } = deps
  const requireReq = (id: number) => {
    const r = getRequirement(db, id)
    if (!r) throw notFound('需求')
    return r
  }

  app.get('/api/prompts', async () => listPrompts())

  app.get('/api/requirements', async () => listRequirements(db))
  app.get('/api/requirements/:id', async (req) => getRequirementDetail(db, idParam(req)) ?? Promise.reject(notFound('需求')))
  app.post('/api/requirements', async (req, reply) => reply.status(201).send(createRequirement(db, validateRequirement(req.body))))
  app.put('/api/requirements/:id', async (req) => updateRequirement(db, idParam(req), validateRequirement(req.body)) ?? Promise.reject(notFound('需求')))
  app.delete('/api/requirements/:id', async (req, reply) => {
    if (!deleteRequirement(db, idParam(req))) throw notFound('需求')
    reply.status(204).send()
  })

  // 解析：需求原文 → 需求点（与已有需求点按标题匹配，沿用编号）
  app.post('/api/requirements/:id/parse', async (req) => {
    const r = requireReq(idParam(req))
    const promptVersion = str((req.body as any)?.promptVersion) || 'v1'
    const { system } = readPrompt('parse', promptVersion)
    const cfg = genConfig()
    const res = await callModel(cfg, buildParseMessages(system, r.name, r.content), deps.fetchImpl)
    const parse = applyParse(db, r.id, { model: cfg.model, promptVersion, tokens: res.tokens, durationMs: res.durationMs, rawOutput: res.content }, parsePoints(res.content))
    return { parse, points: listPoints(db, r.id) }
  })

  app.put('/api/requirements/:id/points', async (req) => {
    const r = requireReq(idParam(req))
    return savePoints(db, r.id, validatePoints(req.body))
  })

  // 生成批次：scope 为 'all' / 'uncovered' / 需求点 id 数组
  app.post('/api/requirements/:id/batches', async (req, reply) => {
    const r = requireReq(idParam(req))
    const b = (req.body ?? {}) as { scope?: unknown; promptVersion?: unknown }
    const promptVersion = str(b.promptVersion) || 'v1'
    const { system } = readPrompt('gen', promptVersion)
    const all = listPoints(db, r.id)
    if (!all.length) throw new ValidationError('还没有需求点，请先解析需求')
    let scope = all
    if (b.scope === 'uncovered') {
      const uncovered = new Set(getCoverage(db, r.id).rows.filter((x) => x.status === 'uncovered').map((x) => x.point.id))
      scope = all.filter((p) => uncovered.has(p.id))
      if (!scope.length) throw new ValidationError('所有需求点都已关联用例，没有需要补生成的')
    } else if (Array.isArray(b.scope)) {
      const ids = new Set(b.scope.map(Number))
      scope = all.filter((p) => ids.has(p.id))
      if (scope.length !== ids.size) throw new ValidationError('scope 中有不存在或已移除的需求点')
    } else if (b.scope !== undefined && b.scope !== 'all') throw new ValidationError("scope 只能是 'all'、'uncovered' 或需求点 id 数组")
    if (!scope.length) throw new ValidationError('请至少选择一个需求点')
    if (scope.length > MAX_SCOPE) throw new ValidationError(`一个批次最多针对 ${MAX_SCOPE} 个需求点，请分批生成`)

    const scopeIds = new Set(scope.map((p) => p.id))
    const existingCases = getCoverage(db, r.id)
      .rows.filter((x) => scopeIds.has(x.point.id))
      .flatMap((x) => x.cases.map((c) => c.name))
    const cfg = genConfig()
    const res = await callModel(cfg, buildGenMessages(system, { url: r.targetUrl, points: scope, existingCases: [...new Set(existingCases)] }), deps.fetchImpl)
    const drafts = parseGenDrafts(res.content, r.targetUrl, new Map(scope.map((p) => [p.code, p.id])))
    const lastParse = db.prepare('SELECT MAX(id) AS id FROM parses WHERE requirement_id = ?').get(r.id) as { id: number | null }
    const batch = createGenBatch(
      db,
      {
        requirementId: r.id,
        parseId: lastParse.id,
        scope: scope.map((p) => p.id),
        model: cfg.model,
        promptVersion,
        inputHash: genInputHash(promptVersion, r.targetUrl, scope),
        tokens: res.tokens,
        durationMs: res.durationMs,
        rawOutput: res.content,
      },
      drafts,
    )
    reply.status(201).send(batch)
  })

  app.get('/api/requirements/:id/coverage', async (req) => getCoverage(db, (requireReq(idParam(req))).id))
  app.get('/api/requirements/:id/coverage.csv', async (req, reply) => {
    const r = requireReq(idParam(req))
    reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="coverage-${r.id}.csv"`)
      .send(coverageCsv(getCoverage(db, r.id)))
  })

  app.get('/api/gen-batches/compare', async (req) => {
    const q = req.query as { a?: string; b?: string }
    const a = Number(q.a)
    const b = Number(q.b)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0) throw new ValidationError('请用 ?a=&b= 指定两个批次')
    return compareBatches(db, a, b) ?? Promise.reject(notFound('批次'))
  })
  app.get('/api/gen-batches/:id', async (req) => getGenBatch(db, idParam(req)) ?? Promise.reject(notFound('批次')))
  // 运行本批已入库的用例，结果用于“生成即跑通率”
  app.post('/api/gen-batches/:id/run', async (req, reply) => {
    const batch = getGenBatch(db, idParam(req))
    if (!batch) throw notFound('批次')
    const ids = batchCaseIds(db, batch.id)
    if (!ids.length) throw new ValidationError('这个批次还没有入库的用例')
    reply.status(202).send(deps.startBatch(`生成批次 batch-${batch.seq} 入库用例`, ids))
  })

  app.post('/api/drafts/:id/review', async (req) => {
    const b = (req.body ?? {}) as Record<string, any>
    if (!['accepted', 'edited', 'discarded'].includes(b.verdict)) throw new ValidationError('verdict 只能是 accepted / edited / discarded')
    if (b.reason !== undefined && b.reason !== null && !REASONS.includes(b.reason)) throw new ValidationError('废弃原因不合法')
    if (b.pointIds !== undefined && (!Array.isArray(b.pointIds) || b.pointIds.some((x: unknown) => !Number.isInteger(x))))
      throw new ValidationError('pointIds 必须是整数数组')
    if (b.verdict === 'edited' && !b.final) throw new ValidationError('修改后通过需要提供终稿 final')
    return (
      reviewDraft(db, idParam(req), {
        verdict: b.verdict,
        final: b.verdict === 'edited' ? validateCase(b.final) : undefined,
        pointIds: b.pointIds,
        reason: b.reason ?? undefined,
        note: typeof b.note === 'string' ? b.note.slice(0, 500) : undefined,
      }) ?? Promise.reject(notFound('草稿'))
    )
  })
}
