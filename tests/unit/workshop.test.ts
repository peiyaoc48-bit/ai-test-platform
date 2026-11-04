// 用例工坊接口的集成测试：真实 Fastify + 内存 SQLite，大模型用假 fetch 代替（按系统提示词区分解析 / 生成）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server/app'
import { openDb, type DB } from '../../server/db'
import type { Executor } from '../../server/runner/executor'
import type { BatchCompare, Coverage, Draft, GenBatchDetail, ReqPoint, RequirementDetail, RequirementSummary } from '../../shared/types'

const DOC = `小待办（TodoLite）登录与待办管理：
1. 用户在登录页输入用户名和密码后点击“登录”，账号正确时进入“我的待办”页，标题显示“欢迎你，<用户名>”。
2. 用户名或密码错误时，停留在登录页，并在登录按钮下方显示红色提示“用户名或密码错误”。
3. 待办页可以在输入框输入内容后点击“添加”新增待办。`

let parseReply: unknown
let genReply: unknown
const calls: { system: string; user: string }[] = []

const fakeFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init!.body))
  const system = body.messages[0].content as string
  calls.push({ system, user: body.messages[1].content })
  const content = JSON.stringify(system.includes('需求点”') && system.includes('excerpt') ? parseReply : genReply)
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1000 } }), { status: 200 })
}

let db: DB
let app: FastifyInstance
let artifactsDir: string
const enqueued: number[] = []
const executor = { enqueue: (id: number) => enqueued.push(id), pending: () => 0 } as unknown as Executor
const ENV_KEYS = ['MIDSCENE_MODEL_API_KEY', 'MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-ws-'))
  db = openDb(':memory:')
  app = await buildApp({ db, port: 3999, artifactsDir, executor, fetchImpl: fakeFetch })
})

afterAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k])
  await app.close()
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

beforeEach(() => {
  process.env.MIDSCENE_MODEL_API_KEY = 'test-key'
  process.env.MIDSCENE_MODEL_BASE_URL = 'https://llm.test/v1'
  process.env.MIDSCENE_MODEL_NAME = 'fake-model'
  db.exec('DELETE FROM requirements; DELETE FROM runs; DELETE FROM batches; DELETE FROM cases;')
  calls.length = 0
  enqueued.length = 0
  parseReply = {
    points: [
      { title: '正确账号登录后进入我的待办页', priority: 'P0', excerpt: '账号正确时进入“我的待办”页' },
      { title: '密码错误时提示用户名或密码错误', priority: 'P1', excerpt: '在登录按钮下方显示红色提示“用户名或密码错误”' },
      { title: '新增待办', priority: 'P0', excerpt: '点击“添加”新增待办' },
      { title: '密码错误三次锁定账号', priority: 'P1', excerpt: '连续三次输错密码锁定账号' }, // 原文没有：模型编造
    ],
  }
  genReply = {
    cases: [
      { name: '正确账号登录', points: ['REQ-001'], confidence: 0.9, steps: [{ type: 'ai_action', content: '输入 demo / demo123 并点击登录' }, { type: 'ai_assert', content: '显示“欢迎你，demo”' }] },
      { name: '错误密码提示', points: ['REQ-002'], confidence: 0.6, steps: [{ type: 'ai_action', content: '输入 demo / wrong 并点击登录' }, { type: 'ai_assert', content: '操作失败' }] },
      { name: '登录后添加待办', points: ['REQ-001', 'REQ-003'], confidence: 0.4, steps: [{ type: 'ai_action', content: '登录后添加“买牛奶”' }, { type: 'ai_assert', content: '列表出现“买牛奶”' }] },
    ],
  }
})

const api = async <T = any>(method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url, payload: payload as any })
  return { status: res.statusCode, body: (res.body && res.headers['content-type']?.toString().includes('json') ? res.json() : res.body) as T }
}

async function setup() {
  const req = (await api<RequirementDetail>('POST', '/api/requirements', { name: 'TodoLite', content: DOC })).body
  const parsed = await api<{ points: ReqPoint[] }>('POST', `/api/requirements/${req.id}/parse`, {})
  expect(parsed.status).toBe(200)
  return { req, points: parsed.body.points }
}

/** 模拟一次运行结果（不经过执行器） */
const fakeRun = (caseId: number, status: string, mutation = 'none') =>
  db.prepare(`INSERT INTO runs (case_id, case_name, url, status, mutation) VALUES (?, 'x', 'u', ?, ?)`).run(caseId, status, mutation)

describe('需求与解析', () => {
  it('校验需求输入', async () => {
    expect((await api('POST', '/api/requirements', { name: '', content: DOC })).body.error).toContain('名称不能为空')
    expect((await api('POST', '/api/requirements', { name: 'a', content: '太短' })).body.error).toContain('至少写 20 个字')
    expect((await api('POST', '/api/requirements', { name: 'a', content: DOC, targetUrl: 'file:///etc' })).status).toBe(400)
  })

  it('解析出带编号的需求点，标出原文里找不到的摘录；记录模型与 Prompt 版本', async () => {
    const { req, points } = await setup()
    expect(points.map((p) => p.code)).toEqual(['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'])
    expect(points.map((p) => p.excerptFound)).toEqual([true, true, true, false])
    expect(calls[0].user).toContain('《TodoLite》')
    const detail = (await api<RequirementDetail>('GET', `/api/requirements/${req.id}`)).body
    expect(detail.parses[0]).toMatchObject({ model: 'fake-model', promptVersion: 'v1', tokens: 1000, added: 4, kept: 0, removed: 0, requirementVersion: 1 })
  })

  it('重新解析：相似的点沿用编号，消失的点移除，新点接着编号', async () => {
    const { req } = await setup()
    parseReply = {
      points: [
        { title: '正确账号登录后进入“我的待办”页', priority: 'P0', excerpt: '账号正确时进入' },
        { title: '新增待办事项', priority: 'P0', excerpt: '点击“添加”新增待办' },
        { title: '待办可以删除', priority: 'P2', excerpt: '' },
      ],
    }
    const { body } = await api<{ parse: any; points: ReqPoint[] }>('POST', `/api/requirements/${req.id}/parse`, {})
    expect(body.parse).toMatchObject({ added: 1, kept: 2, removed: 2 })
    expect(body.points.map((p) => `${p.code} ${p.title}`)).toEqual(['REQ-001 正确账号登录后进入“我的待办”页', 'REQ-003 新增待办事项', 'REQ-005 待办可以删除'])
  })

  it('人工编辑需求点：更新、新增、删除；人工新增的点不会被重新解析移除', async () => {
    const { req, points } = await setup()
    const edited = points.slice(0, 2).map((p) => ({ ...p, priority: 'P2' }))
    const saved = await api<ReqPoint[]>('PUT', `/api/requirements/${req.id}/points`, {
      points: [...edited, { title: '人工补充：退出登录', priority: 'P1', detail: '', sourceExcerpt: '' }],
    })
    expect(saved.body.map((p) => `${p.code}/${p.priority}`)).toEqual(['REQ-001/P2', 'REQ-002/P2', 'REQ-005/P1'])
    await api('POST', `/api/requirements/${req.id}/parse`, {})
    const after = (await api<RequirementDetail>('GET', `/api/requirements/${req.id}`)).body.points
    expect(after.some((p) => p.title === '人工补充：退出登录')).toBe(true)
    expect((await api('PUT', `/api/requirements/${req.id}/points`, { points: [{ id: 99999, title: 'x', priority: 'P0' }] })).status).toBe(400)
  })

  it('修改原文时版本号 + 1，内容不变则不变', async () => {
    const { req } = await setup()
    expect((await api('PUT', `/api/requirements/${req.id}`, { name: '改名', content: DOC })).body.version).toBe(1)
    expect((await api('PUT', `/api/requirements/${req.id}`, { name: '改名', content: DOC + '\n4. 新规则' })).body.version).toBe(2)
  })

  it('未配置模型时返回 MODEL_NOT_CONFIGURED', async () => {
    const req = (await api('POST', '/api/requirements', { name: 'a', content: DOC })).body
    delete process.env.MIDSCENE_MODEL_API_KEY
    const res = await api('POST', `/api/requirements/${req.id}/parse`, {})
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MODEL_NOT_CONFIGURED')
  })
})

describe('生成批次与审核', () => {
  it('生成：草稿带需求点与置信度，消息里只包含本批范围的需求点', async () => {
    const { req, points } = await setup()
    const res = await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, { scope: points.slice(0, 3).map((p) => p.id) })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ seq: 1, promptVersion: 'v1', model: 'fake-model', tokens: 1000 })
    expect(res.body.drafts).toHaveLength(3)
    expect(res.body.drafts[2].pointIds).toEqual([points[0].id, points[2].id])
    expect(calls.at(-1)!.user).toContain('REQ-003')
    expect(calls.at(-1)!.user).not.toContain('REQ-004')
    expect(res.body.stats).toMatchObject({ total: 3, reviewed: 0, adoption: { rate: null } })
  })

  it('审核三种判定 → 入库与度量；重复审核 409；废弃必须选原因', async () => {
    const { req, points } = await setup()
    const batch = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, { scope: points.slice(0, 3).map((p) => p.id) })).body
    const [d1, d2, d3] = batch.drafts

    const a = await api<Draft>('POST', `/api/drafts/${d1.id}/review`, { verdict: 'accepted' })
    expect(a.body).toMatchObject({ verdict: 'accepted', editStats: null })
    expect(a.body.caseId).toBeGreaterThan(0)
    expect((await api('POST', `/api/drafts/${d1.id}/review`, { verdict: 'accepted' })).status).toBe(409)

    expect((await api('POST', `/api/drafts/${d2.id}/review`, { verdict: 'discarded' })).body.error).toContain('必须选择原因')
    expect((await api('POST', `/api/drafts/${d2.id}/review`, { verdict: 'discarded', reason: 'other' })).body.error).toContain('备注')
    expect((await api('POST', `/api/drafts/${d2.id}/review`, { verdict: 'discarded', reason: 'vague_assert' })).body.verdict).toBe('discarded')

    const final = { name: d3.name, description: '', url: d3.url, steps: [...d3.steps.slice(0, 1), { type: 'ai_assert', content: '列表第一项显示“买牛奶”' }] }
    const e = await api<Draft>('POST', `/api/drafts/${d3.id}/review`, { verdict: 'edited', final })
    expect(e.body).toMatchObject({ verdict: 'edited', editStats: { kept: 1, changed: 1, added: 0, removed: 0 } })
    // 原稿不变，终稿另存
    expect(e.body.steps[1].content).toBe('列表出现“买牛奶”')
    expect(e.body.final!.steps[1].content).toBe('列表第一项显示“买牛奶”')

    const stats = (await api<GenBatchDetail>('GET', `/api/gen-batches/${batch.id}`)).body.stats
    expect(stats).toMatchObject({ reviewed: 3, accepted: 1, edited: 1, discarded: 1, avgEditedSteps: 1, newlyLinked: 2, tokensPerAdopted: 500 })
    expect(stats.adoption.rate).toBeCloseTo(2 / 3)
    expect(stats.reasons.vague_assert).toBe(1)
  })

  it('“修改后通过”但内容没变时按“通过”记；改了关联需求点算修改', async () => {
    const { req, points } = await setup()
    const [d1, d2] = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, {})).body.drafts
    const same = { name: d1.name, description: d1.description, url: d1.url, steps: d1.steps }
    expect((await api('POST', `/api/drafts/${d1.id}/review`, { verdict: 'edited', final: same })).body.verdict).toBe('accepted')
    const same2 = { name: d2.name, description: d2.description, url: d2.url, steps: d2.steps }
    const r = await api('POST', `/api/drafts/${d2.id}/review`, { verdict: 'edited', final: same2, pointIds: [points[1].id, points[0].id] })
    expect(r.body.verdict).toBe('edited')
    expect(r.body.final.pointIds).toEqual([points[1].id, points[0].id])
  })

  it('关联已移除或其他需求的需求点时报错', async () => {
    const { req, points } = await setup()
    const [d1] = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, {})).body.drafts
    await api('PUT', `/api/requirements/${req.id}/points`, { points: points.slice(1) })
    const res = await api('POST', `/api/drafts/${d1.id}/review`, { verdict: 'accepted' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('已被移除')
  })

  it('scope 校验：未覆盖为空、超出范围、未知 id', async () => {
    const { req } = await setup()
    expect((await api('POST', `/api/requirements/${req.id}/batches`, { scope: [99999] })).status).toBe(400)
    expect((await api('POST', `/api/requirements/${req.id}/batches`, { scope: 'xx' })).status).toBe(400)
    expect((await api('POST', `/api/requirements/${req.id}/batches`, { promptVersion: 'v99' })).body.error).toContain('不存在')
    expect((await api('POST', `/api/requirements/${req.id}/batches`, { promptVersion: '../x' })).status).toBe(400)
  })

  it('运行本批入库用例：创建批量运行并入队', async () => {
    const { req } = await setup()
    const batch = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, {})).body
    expect((await api('POST', `/api/gen-batches/${batch.id}/run`)).status).toBe(400)
    await api('POST', `/api/drafts/${batch.drafts[0].id}/review`, { verdict: 'accepted' })
    const res = await api('POST', `/api/gen-batches/${batch.id}/run`)
    expect(res.status).toBe(202)
    expect(enqueued).toHaveLength(1)
  })
})

describe('覆盖矩阵', () => {
  it('区分未覆盖 / 已关联 / 已验证 / 失败；P0 未覆盖告警；按批次累计', async () => {
    const { req, points } = await setup()
    const b1 = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, { scope: [points[0].id, points[1].id] })).body
    const c1 = (await api<Draft>('POST', `/api/drafts/${b1.drafts[0].id}/review`, { verdict: 'accepted' })).body.caseId! // → REQ-001
    const c2 = (await api<Draft>('POST', `/api/drafts/${b1.drafts[1].id}/review`, { verdict: 'accepted' })).body.caseId! // → REQ-002

    fakeRun(c1, 'failed')
    fakeRun(c1, 'passed')
    fakeRun(c2, 'passed')
    fakeRun(c2, 'failed')
    fakeRun(c2, 'passed', 'attr') // 变更注入的运行不算
    fakeRun(c2, 'skipped') // 跳过的不算

    let cov = (await api<Coverage>('GET', `/api/requirements/${req.id}/coverage`)).body
    const status = (code: string) => cov.rows.find((r) => r.point.code === code)!.status
    expect([status('REQ-001'), status('REQ-002'), status('REQ-003'), status('REQ-004')]).toEqual(['verified', 'failed', 'uncovered', 'uncovered'])
    expect(cov.p0Uncovered.map((p) => p.code)).toEqual(['REQ-003'])
    expect(cov.timeline).toEqual([{ batchId: b1.id, seq: 1, promptVersion: 'v1', linked: 2, rate: 0.5 }])

    // 只针对未覆盖的点补生成
    genReply = { cases: [{ name: '新增待办', points: ['REQ-003'], steps: [{ type: 'ai_assert', content: '出现添加按钮' }] }] }
    const b2 = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, { scope: 'uncovered' })).body
    expect(b2.scope).toEqual([points[2].id, points[3].id])
    await api('POST', `/api/drafts/${b2.drafts[0].id}/review`, { verdict: 'accepted' })
    cov = (await api<Coverage>('GET', `/api/requirements/${req.id}/coverage`)).body
    expect(status('REQ-003')).toBe('linked')
    expect(cov.timeline.map((t) => t.linked)).toEqual([2, 3])
    expect((await api<GenBatchDetail>('GET', `/api/gen-batches/${b2.id}`)).body.stats.newlyLinked).toBe(1)

    // 首次运行通过率：c1 首次失败、c2 首次通过
    expect((await api<GenBatchDetail>('GET', `/api/gen-batches/${b1.id}`)).body.stats.firstRun).toMatchObject({ k: 1, n: 2 })

    const csv = (await api<string>('GET', `/api/requirements/${req.id}/coverage.csv`)).body
    expect(csv.split('\n')[0]).toContain('编号,需求点,优先级,覆盖状态')
    expect(csv).toContain('REQ-001,正确账号登录后进入我的待办页,P0,已验证')

    const list = (await api<RequirementSummary[]>('GET', '/api/requirements')).body
    expect(list[0]).toMatchObject({ points: 4, batches: 2, pendingDrafts: 1, linkedRate: 0.75, verifiedRate: 0.25 })
  })

  it('删除用例后关联随之解除', async () => {
    const { req } = await setup()
    const b = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, {})).body
    const caseId = (await api<Draft>('POST', `/api/drafts/${b.drafts[0].id}/review`, { verdict: 'accepted' })).body.caseId
    await api('DELETE', `/api/cases/${caseId}`)
    const cov = (await api<Coverage>('GET', `/api/requirements/${req.id}/coverage`)).body
    expect(cov.counts.uncovered).toBe(4)
    expect((await api<GenBatchDetail>('GET', `/api/gen-batches/${b.id}`)).body.drafts[0].caseId).toBeNull()
  })
})

describe('批次对比', () => {
  it('同范围两批：给出 Fisher p 值与样本量提示', async () => {
    const { req } = await setup()
    const a = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, {})).body
    const b = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, {})).body
    for (const d of a.drafts) await api('POST', `/api/drafts/${d.id}/review`, { verdict: 'accepted' })
    for (const d of b.drafts) await api('POST', `/api/drafts/${d.id}/review`, { verdict: 'discarded', reason: 'low_value' })
    const cmp = (await api<BatchCompare>('GET', `/api/gen-batches/compare?a=${a.id}&b=${b.id}`)).body
    expect(cmp).toMatchObject({ sameScope: true, enoughSamples: false })
    expect(cmp.adoptionPValue).toBeCloseTo(0.1, 6) // 3/3 vs 0/3
    expect((await api('GET', '/api/gen-batches/compare?a=1')).status).toBe(400)
  })
})

describe('公开演示站（只读访客）', () => {
  it('访客只能浏览需求、批次与度量，任何会调用模型或改数据的接口都返回 403，且模型一次都没被调用；登录后可以生成', async () => {
    const { req, points } = await setup()
    const batch = (await api<GenBatchDetail>('POST', `/api/requirements/${req.id}/batches`, { scope: 'all' })).body
    const viewerApp = await buildApp({ db, port: 3999, artifactsDir, executor, fetchImpl: fakeFetch, access: { accessCode: 'c', publicDemo: true, secret: 's' } })
    const as = (headers = {}) => (method: string, url: string, payload: unknown = {}) => viewerApp.inject({ method: method as any, url, payload: payload as any, headers })
    const viewer = as()
    const before = calls.length

    for (const url of ['/api/prompts', '/api/requirements', `/api/requirements/${req.id}`, `/api/requirements/${req.id}/coverage`, `/api/requirements/${req.id}/coverage.csv`, `/api/gen-batches/${batch.id}`]) {
      expect((await viewer('GET', url)).statusCode, url).toBe(200)
    }
    const writes: [string, string, unknown?][] = [
      ['POST', '/api/requirements', { name: 'x', content: DOC }],
      ['PUT', `/api/requirements/${req.id}`, { name: 'x', content: DOC }],
      ['DELETE', `/api/requirements/${req.id}`],
      ['POST', `/api/requirements/${req.id}/parse`],
      ['PUT', `/api/requirements/${req.id}/points`, { points: [] }],
      ['POST', `/api/requirements/${req.id}/batches`, { scope: 'all' }],
      ['POST', `/api/requirements/${req.id}/batches`, { scope: [points[0].id], promptVersion: 'v2' }],
      ['POST', `/api/gen-batches/${batch.id}/run`],
      ['POST', `/api/drafts/${batch.drafts[0].id}/review`, { verdict: 'accepted' }],
    ]
    for (const [method, url, payload] of writes) {
      const r = await viewer(method, url, payload)
      expect([r.statusCode, r.json().code], `${method} ${url}`).toEqual([403, 'READ_ONLY'])
    }
    expect(calls.length).toBe(before)
    expect(enqueued).toEqual([])

    const login = await viewer('POST', '/api/login', { code: 'c' })
    const admin = as({ cookie: (login.headers['set-cookie'] as string).split(';')[0] })
    expect((await admin('POST', `/api/requirements/${req.id}/batches`, { scope: [points[0].id] })).statusCode).toBe(201)
    expect(calls.length).toBe(before + 1)
    await viewerApp.close()
  })
})
