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
let port = 0
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
    templateVars: () => ({ DEMO: `http://127.0.0.1:${port}/demo`, DEMO_API: `http://127.0.0.1:${port}/demo-api` }),
  })
  // 先监听拿到端口，演示站点地址依赖端口
  app = await buildApp({ db, port: 0, artifactsDir, executor })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
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
  db.exec('DELETE FROM runs; DELETE FROM batches; DELETE FROM suites; DELETE FROM cases; DELETE FROM environments;')
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
    const r = await api('POST', '/api/cases', { name: 'a', url: 'x', steps: [{ type: 'code', content: '1' }] })
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

describe('接口步骤', () => {
  it('纯接口用例不启动浏览器：登录 → 提取 token → 增删改查', async () => {
    const run = await runAndWait((await create(SAMPLE_CASES[3])).id)
    expect(run.status).toBe('passed')
    expect(run.steps.every((s) => s.status === 'passed' && s.screenshot === null)).toBe(true)
    const login = run.steps[0].output as any
    expect(login.response.status).toBe(200)
    expect(login.extracted.token).toMatch(/^[0-9a-f]{32}$/)
    // 报告里不明文保存 token
    const create_ = run.steps[2].output as any
    expect(create_.request.headers.Authorization).toMatch(/\*\*\*$/)
  })

  it('接口断言失败时报告带上响应，后续步骤不执行', async () => {
    const c = await create({
      name: '错误密码',
      description: '',
      url: '',
      steps: [
        { type: 'api', content: 'method: POST\nurl: "{{DEMO_API}}/login"\njson: { username: demo, password: x }\nexpect: { status: 200 }' },
        { type: 'api', content: 'url: "{{DEMO_API}}/me"' },
      ],
    })
    const run = await runAndWait(c.id)
    expect(run.status).toBe('failed')
    expect(run.steps[0].error).toContain('状态码期望 200，实际 401')
    expect((run.steps[0].output as any).response.body).toEqual({ error: '用户名或密码错误' })
    expect(run.steps[1].status).toBe('not_run')
  })

  it('接口步骤与页面步骤可混用：接口造数据，页面再验证', async () => {
    const c = await create({
      name: '混合',
      description: '',
      url: '{{DEMO}}/index.html',
      steps: [
        { type: 'api', content: 'method: POST\nurl: "{{DEMO_API}}/login"\njson: { username: demo, password: demo123 }\nextract: { user: username }' },
        { type: 'code', content: `await page.fill('[data-test=username]', vars.user)\nawait page.fill('[data-test=password]', 'demo123')\nawait page.click('[data-test=submit]')\nawait expect(page.locator('[data-test=welcome]')).toContainText(vars.user)` },
      ],
    })
    expect((await runAndWait(c.id)).status).toBe('passed')
  })
})

describe('环境配置', () => {
  const mkEnv = async (patch: Record<string, unknown> = {}) =>
    (
      await api('POST', '/api/environments', {
        name: '本地',
        baseUrl: `http://127.0.0.1:${port}/demo`,
        vars: { USER: 'demo' },
        launchArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        permissions: ['camera'],
        localStorage: { 'todo-flag': 'preset' },
        stepTimeoutMs: 20000,
        ...patch,
      })
    ).body

  it('URL 用 {{BASE_URL}}，代码步骤读环境变量；权限、模拟摄像头、预置本地存储都生效', async () => {
    const env = await mkEnv()
    const c = await create({
      name: '环境',
      description: '',
      url: '{{BASE_URL}}/index.html',
      steps: [
        { type: 'code', content: `await page.fill('[data-test=username]', vars.USER)\nawait page.fill('[data-test=password]', 'demo123')\nawait page.click('[data-test=submit]')\nawait expect(page.locator('[data-test=welcome]')).toContainText(vars.USER)` },
        { type: 'code', content: `if (await page.evaluate(() => localStorage.getItem('todo-flag')) !== 'preset') throw new Error('本地存储未预置')` },
        { type: 'code', content: `const n = await page.evaluate(async () => (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks().length)\nif (n !== 1) throw new Error('没有拿到模拟摄像头')` },
        { type: 'api', content: 'url: "{{DEMO_API}}/login"\nmethod: POST\njson: { username: "{{USER}}", password: demo123 }\nexpect: { status: 200 }' },
      ],
    })
    const { body } = await api('POST', `/api/cases/${c.id}/run`, { envId: env.id })
    await executor.idle()
    const run = (await api<RunDetail>('GET', `/api/runs/${body.runId}`)).body
    expect(run.steps.map((s) => s.error ?? s.status)).toEqual(['passed', 'passed', 'passed', 'passed'])
    expect(run.url).toBe(`http://127.0.0.1:${port}/demo/index.html`)
    expect(run.envName).toBe('本地')

    // 运行保存的是环境快照：之后修改环境不影响历史报告
    await api('PUT', `/api/environments/${env.id}`, { ...env, name: '已改名' })
    expect((await api<RunDetail>('GET', `/api/runs/${body.runId}`)).body.env?.name).toBe('本地')
  })

  it('变量缺失时拒绝运行并提示选择环境；不存在的环境 400', async () => {
    const c = await create({ name: '缺变量', description: '', url: '{{BASE_URL}}/index.html', steps: [{ type: 'code', content: '1' }] })
    const r = await api('POST', `/api/cases/${c.id}/run`, {})
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('{{BASE_URL}} 未定义')
    expect((await api('POST', `/api/cases/${c.id}/run`, { envId: 999 })).status).toBe(400)
  })

  it('用例集使用默认环境，运行时可覆盖', async () => {
    const env = await mkEnv({ name: '集默认' })
    const c = await create({ name: 'x', description: '', url: '{{BASE_URL}}/index.html', steps: [{ type: 'code', content: 'await page.title()' }] })
    const suite = (await api('POST', '/api/suites', { name: 's', caseIds: [c.id], envId: env.id })).body
    const started = (await api('POST', `/api/suites/${suite.id}/run`, {})).body
    await executor.idle()
    const batch = (await api('GET', `/api/batches/${started.batchId}`)).body
    expect(batch.status).toBe('passed')
    expect(batch.runs[0].envName).toBe('集默认')
    expect((await api('POST', `/api/suites/${suite.id}/run`, { envId: null })).status).toBe(400) // 覆盖成无环境，缺 BASE_URL
  })
})

describe('用例集与批量运行', () => {
  it('运行用例集：按顺序排队执行，批次汇总状态并可导出 JUnit', async () => {
    const pass = await create(SAMPLE_CASES[0])
    const fail = await create({ name: '会失败', description: '', url: '{{DEMO}}/index.html', steps: [{ type: 'code', content: 'throw new Error("boom")' }] })
    const suite = (await api('POST', '/api/suites', { name: '回归', caseIds: [fail.id, pass.id] })).body
    expect(suite.caseIds).toEqual([fail.id, pass.id])

    const started = await api('POST', `/api/suites/${suite.id}/run`, { trigger: 'ci' })
    expect(started.status).toBe(202)
    expect(started.body.runIds).toHaveLength(2)
    await executor.idle()

    const batch = (await api('GET', `/api/batches/${started.body.batchId}`)).body
    expect(batch).toMatchObject({ status: 'failed', trigger: 'ci', total: 2, passed: 1, failed: 1, suiteId: suite.id })
    expect(batch.runs.map((r: any) => r.caseName)).toEqual(['会失败', SAMPLE_CASES[0].name])
    expect(batch.durationMs).toBeGreaterThan(0)

    const junit = await app.inject({ method: 'GET', url: `/api/batches/${batch.id}/junit` })
    expect(junit.headers['content-type']).toContain('application/xml')
    expect(junit.body).toContain('tests="2" failures="1"')
    expect(junit.body).toContain('boom')

    const listed = (await api('GET', '/api/suites')).body
    expect(listed[0].lastBatch.id).toBe(batch.id)
  })

  it('勾选多个用例临时批量运行；用例被删除后用例集仍可运行剩余用例', async () => {
    const a = await create(SAMPLE_CASES[3])
    const b = await create(SAMPLE_CASES[3])
    const adhoc = await api('POST', '/api/batches', { caseIds: [a.id, b.id] })
    expect(adhoc.status).toBe(202)
    await executor.idle()
    expect((await api('GET', `/api/batches/${adhoc.body.batchId}`)).body.status).toBe('passed')

    const suite = (await api('POST', '/api/suites', { name: 's', caseIds: [a.id, b.id] })).body
    await api('DELETE', `/api/cases/${a.id}`)
    const r = await api('POST', `/api/suites/${suite.id}/run`)
    expect(r.body.runIds).toHaveLength(1)
    await executor.idle()
  })

  it('参数校验与 404', async () => {
    expect((await api('POST', '/api/suites', { name: 'x', caseIds: [999] })).body.error).toContain('不存在')
    expect((await api('POST', '/api/batches', { caseIds: [] })).status).toBe(400)
    expect((await api('POST', '/api/suites/999/run')).status).toBe(404)
    expect((await api('GET', '/api/batches/999/junit')).status).toBe(404)
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
