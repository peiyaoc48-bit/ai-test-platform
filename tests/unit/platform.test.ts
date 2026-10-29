// 集成测试：真实 Fastify + 内存 SQLite + 本机 Chrome，自然语言步骤用假的 Agent 代替模型
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server/app'
import { openDb, type DB } from '../../server/db'
import type { AiAgent } from '../../server/runner/ai'
import { Executor } from '../../server/runner/executor'
import { SAMPLE_CASES } from '../../server/seed'
import type { RunDetail, Stats, TestCase } from '../../shared/types'

let db: DB
let app: FastifyInstance
let executor: Executor
let modelOn = false
let artifactsDir: string
const agentCalls: string[] = []

/** 假 Agent：每次调用计 1 次模型、100 token；内容含“失败”的断言会抛错 */
function fakeAgent(): AiAgent {
  const metrics = { calls: 0, totalTokens: 0 }
  const call = async (kind: string, prompt: string) => {
    agentCalls.push(`${kind}:${prompt}`)
    metrics.calls += 1
    metrics.totalTokens += 100
    if (prompt.includes('失败')) throw new Error(`断言失败：${prompt}`)
    return kind === 'query' ? ['买牛奶'] : undefined
  }
  return {
    aiAct: (p) => call('act', p),
    aiAssert: (p) => call('assert', p),
    aiQuery: (p) => call('query', p),
    get metrics() {
      return metrics
    },
  }
}

beforeAll(async () => {
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-'))
  db = openDb(':memory:')
  executor = new Executor({
    db,
    artifactsDir,
    browserChannel: process.env.BROWSER_CHANNEL ?? 'chrome',
    stepTimeoutMs: 3000,
    modelConfigured: () => modelOn,
    agentFactory: async () => fakeAgent(),
  })
  // 先监听拿到端口，演示站点地址依赖端口
  app = await buildApp({ db, port: 0, artifactsDir, executor })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as AddressInfo).port
  await app.close()
  app = await buildApp({ db, port, artifactsDir, executor })
  await app.listen({ port, host: '127.0.0.1' })
}, 30_000)

afterAll(async () => {
  await app?.close()
  await executor?.close()
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.exec('DELETE FROM runs; DELETE FROM cases;')
  modelOn = false
  agentCalls.length = 0
})

const api = async <T = any>(method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url, payload: payload as any })
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T }
}

async function runAndWait(caseId: number) {
  const { status, body } = await api<{ runId: number }>('POST', `/api/cases/${caseId}/run`)
  expect(status).toBe(202)
  await executor.idle()
  return (await api<RunDetail>('GET', `/api/runs/${body.runId}`)).body
}

const create = async (input = SAMPLE_CASES[0]) => (await api<TestCase>('POST', '/api/cases', input)).body

describe('用例 CRUD 接口', () => {
  it('新建 → 查询 → 修改 → 删除', async () => {
    const c = await create()
    expect(c.id).toBeGreaterThan(0)
    expect((await api<TestCase[]>('GET', '/api/cases')).body).toHaveLength(1)

    const updated = await api<TestCase>('PUT', `/api/cases/${c.id}`, { ...SAMPLE_CASES[0], name: '改名' })
    expect(updated.body.name).toBe('改名')
    expect(updated.body.steps).toEqual(SAMPLE_CASES[0].steps)

    expect((await api('DELETE', `/api/cases/${c.id}`)).status).toBe(204)
    expect((await api('GET', `/api/cases/${c.id}`)).status).toBe(404)
  })

  it('非法输入返回 400 与中文提示', async () => {
    const r = await api('POST', '/api/cases', { name: 'a', url: 'x', steps: [] })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('URL')
  })

  it('未配置模型时生成接口返回 MODEL_NOT_CONFIGURED', async () => {
    const saved = process.env.MIDSCENE_MODEL_API_KEY
    delete process.env.MIDSCENE_MODEL_API_KEY
    const r = await api('POST', '/api/generate', { requirement: '用户可以登录并添加待办事项' })
    if (saved !== undefined) process.env.MIDSCENE_MODEL_API_KEY = saved
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('MODEL_NOT_CONFIGURED')
  })
})

describe('执行引擎', () => {
  it('纯代码用例在演示站点上全部通过，并为每步截图', async () => {
    const run = await runAndWait((await create(SAMPLE_CASES[0])).id)
    expect(run.status).toBe('passed')
    expect(run.steps.map((s) => s.status)).toEqual(['passed', 'passed', 'passed', 'passed'])
    for (const s of run.steps) expect(fs.existsSync(path.join(artifactsDir, s.screenshot!))).toBe(true)
  })

  it('未配置模型：自然语言步骤跳过，代码步骤照常执行', async () => {
    const run = await runAndWait((await create(SAMPLE_CASES[1])).id)
    expect(run.steps.map((s) => s.status)).toEqual(['passed', 'passed', 'skipped'])
    expect(run.steps[2].error).toBe('跳过（未配置模型）')
    expect(run.status).toBe('passed')
    expect(agentCalls).toEqual([])
  })

  it('全部是自然语言步骤且未配置模型时，运行记为跳过', async () => {
    const run = await runAndWait((await create(SAMPLE_CASES[2])).id)
    expect(run.status).toBe('skipped')
    expect(run.skipped).toBe(6)
  })

  it('配置模型后按步骤调用 Agent，并统计每步模型调用与 token', async () => {
    modelOn = true
    const run = await runAndWait((await create(SAMPLE_CASES[2])).id)
    expect(run.status).toBe('passed')
    expect(agentCalls).toHaveLength(6)
    expect(run.steps.every((s) => s.aiCalls === 1 && s.tokens === 100)).toBe(true)
    expect(run.aiCalls).toBe(6)
    expect(run.tokens).toBe(600)
    expect(run.steps[4].output).toEqual(['买牛奶'])
  })

  it('步骤失败：记录错误与截图，后续步骤标记为未执行', async () => {
    const c = await create({
      name: '失败用例',
      description: '',
      url: '{{DEMO}}/index.html',
      steps: [
        { type: 'code', content: `await expect(page.locator('[data-test=submit]')).toHaveText('注册', { timeout: 500 })` },
        { type: 'code', content: 'await page.click("[data-test=submit]")' },
      ],
    })
    const run = await runAndWait(c.id)
    expect(run.status).toBe('failed')
    expect(run.steps[0].status).toBe('failed')
    expect(run.steps[0].error).toContain('toHaveText')
    expect(run.steps[0].screenshot).toMatch(/step-1\.jpg$/)
    expect(run.steps[1].status).toBe('not_run')
  })

  it('AI 断言失败同样计为失败，并保留已消耗的 token', async () => {
    modelOn = true
    const c = await create({
      name: 'AI 断言失败',
      description: '',
      url: '{{DEMO}}/index.html',
      steps: [{ type: 'ai_assert', content: '这一步会失败' }, { type: 'ai_action', content: '点击登录' }],
    })
    const run = await runAndWait(c.id)
    expect(run.status).toBe('failed')
    expect(run.steps[0]).toMatchObject({ status: 'failed', aiCalls: 1, tokens: 100 })
    expect(run.steps[1].status).toBe('not_run')
  })

  it('代码步骤可以读取 AI 提取步骤的结果（vars.stepN）', async () => {
    modelOn = true
    const c = await create({
      name: 'vars',
      description: '',
      url: '{{DEMO}}/index.html',
      steps: [
        { type: 'ai_query', content: 'string[]，待办' },
        { type: 'code', content: `if (vars.step1[0] !== '买牛奶') throw new Error('vars 不对')` },
      ],
    })
    expect((await runAndWait(c.id)).status).toBe('passed')
  })

  it('目标页面打不开时运行记为异常', async () => {
    const c = await create({ name: '打不开', description: '', url: 'http://127.0.0.1:1/', steps: [{ type: 'code', content: '1' }] })
    const run = await runAndWait(c.id)
    expect(run.status).toBe('error')
    expect(run.error).toContain('打开目标页面失败')
    expect(run.steps[0].status).toBe('not_run')
  })
})

describe('统计接口', () => {
  it('通过率 = 通过 / (通过 + 失败 + 异常)，跳过的运行不计入', async () => {
    const pass = await create(SAMPLE_CASES[0])
    const skip = await create(SAMPLE_CASES[2])
    const fail = await create({ name: 'f', description: '', url: '{{DEMO}}/index.html', steps: [{ type: 'code', content: 'throw new Error("x")' }] })
    await runAndWait(pass.id)
    await runAndWait(pass.id)
    await runAndWait(fail.id)
    await runAndWait(skip.id)
    const { body } = await api<Stats>('GET', '/api/stats?days=7')
    expect(body.totalRuns).toBe(4)
    expect(body.passedRuns).toBe(2)
    expect(body.failedRuns).toBe(1)
    expect(body.passRate).toBeCloseTo(2 / 3)
    expect(body.daily).toHaveLength(1)

    const forCase = await api<Stats>('GET', `/api/stats?caseId=${pass.id}`)
    expect(forCase.body.passRate).toBe(1)
  })
})
