import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { PlatformConfig } from '../shared/types.js'
import { demoBaseUrl, modelConfig } from './config.js'
import type { DB } from './db.js'
import { createCase, deleteCase, getCase, listCases, updateCase } from './repo/cases.js'
import { createRun, getRun, getStats, listRuns } from './repo/runs.js'
import { createBatch, createSuite, deleteSuite, getBatch, getSuite, listBatches, listSuites, updateSuite } from './repo/suites.js'
import { toJUnit } from './report/junit.js'
import { getDashboard } from './repo/dashboard.js'
import { exportPlaywright } from './report/export.js'
import type { Executor } from './runner/executor.js'
import { generateDrafts } from './ai/generate.js'
import { isMutation } from './runner/mutations.js'
import type { Mutation } from '../shared/types.js'
import { buildVars, resolveTemplate } from './env.js'
import { createEnvironment, deleteEnvironment, getEnvironment, listEnvironments, snapshot, updateEnvironment } from './repo/environments.js'
import { demoApi } from './demo-api.js'
import { isValidTargetUrl, parseEnvId, validateCase, validateCaseIds, validateEnvironment, validateSuite, ValidationError } from './validate.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface AppOptions {
  db: DB
  port: number
  artifactsDir: string
  midsceneDir?: string
  executor: Executor
  /** 生产模式下托管前端构建产物 */
  webDist?: string
  logger?: boolean
  /** 测试时注入假的 fetch */
  fetchImpl?: typeof fetch
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db } = opts
  const app = Fastify({ logger: opts.logger ?? false })

  app.setErrorHandler((err: any, _req, reply) => {
    const status = err instanceof ValidationError ? 400 : err.statusCode ?? 500
    if (status >= 500) app.log.error(err)
    reply.status(status).send({ error: err.message, code: err.code })
  })

  // 演示被测站点与运行截图
  await app.register(fastifyStatic, { root: path.join(here, 'demo-site'), prefix: '/demo/' })
  await app.register(demoApi, { prefix: '/demo-api' })
  fs.mkdirSync(opts.artifactsDir, { recursive: true })
  await app.register(fastifyStatic, { root: opts.artifactsDir, prefix: '/artifacts/', decorateReply: false })
  if (opts.midsceneDir) {
    fs.mkdirSync(opts.midsceneDir, { recursive: true })
    await app.register(fastifyStatic, { root: opts.midsceneDir, prefix: '/midscene/', decorateReply: false })
  }

  const idParam = (req: { params: unknown }) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('id 不合法')
    return id
  }
  const notFound = (what: string) => Object.assign(new Error(`${what}不存在`), { statusCode: 404 })

  app.get('/api/config', async (): Promise<PlatformConfig> => {
    const m = modelConfig()
    return {
      modelConfigured: m.configured,
      modelName: m.configured ? m.visionModel : null,
      genModelName: m.configured ? m.genModel : null,
      demoUrl: demoBaseUrl(opts.port),
    }
  })

  app.get('/api/dashboard', async () => getDashboard(db))

  // —— 用例管理 ——
  app.get('/api/cases', async () => listCases(db))
  app.get('/api/cases/:id', async (req) => getCase(db, idParam(req)) ?? Promise.reject(notFound('用例')))
  app.post('/api/cases', async (req, reply) => reply.status(201).send(createCase(db, validateCase(req.body))))
  app.put('/api/cases/:id', async (req) => updateCase(db, idParam(req), validateCase(req.body)) ?? Promise.reject(notFound('用例')))
  app.delete('/api/cases/:id', async (req, reply) => {
    if (!deleteCase(db, idParam(req))) throw notFound('用例')
    reply.status(204).send()
  })

  // —— 环境 ——
  const envExists = (id: number) => getEnvironment(db, id) !== null
  app.get('/api/environments', async () => listEnvironments(db))
  app.get('/api/environments/:id', async (req) => getEnvironment(db, idParam(req)) ?? Promise.reject(notFound('环境')))
  app.post('/api/environments', async (req, reply) => reply.status(201).send(createEnvironment(db, validateEnvironment(req.body))))
  app.put('/api/environments/:id', async (req) => updateEnvironment(db, idParam(req), validateEnvironment(req.body)) ?? Promise.reject(notFound('环境')))
  app.delete('/api/environments/:id', async (req, reply) => {
    if (!deleteEnvironment(db, idParam(req))) throw notFound('环境')
    reply.status(204).send()
  })

  /** 取环境快照，并返回解析用例 URL 的函数（变量缺失时报 400） */
  const prepareEnv = (envId: number | null) => {
    const env = envId ? snapshot(getEnvironment(db, envId)!) : null
    const vars = buildVars({ DEMO: demoBaseUrl(opts.port), DEMO_API: `http://127.0.0.1:${opts.port}/demo-api` }, env)
    return { env, vars, resolve: (url: string) => (url ? resolveTemplate(url, vars) : '') }
  }

  // 清除某个用例的 Midscene 缓存（页面改版后缓存的定位可能失效）
  app.delete('/api/cases/:id/ai-cache', async (req, reply) => {
    const id = idParam(req)
    if (opts.midsceneDir) fs.rmSync(path.join(opts.midsceneDir, 'cache', `case-${id}.cache.yaml`), { force: true })
    reply.status(204).send()
  })

  // 导出为 Playwright 测试文件；?envId= 指定按哪个环境展开地址与浏览器配置
  app.get('/api/cases/:id/export', async (req, reply) => {
    const tc = getCase(db, idParam(req))
    if (!tc) throw notFound('用例')
    const { env, vars, resolve } = prepareEnv(parseEnvId((req.query as any)?.envId, envExists))
    const file = `case-${tc.id}.spec.ts`
    reply
      .type('text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${file}"`)
      .send(exportPlaywright(tc, { url: resolve(tc.url), env, fixedVars: vars }))
  })

  // —— 执行与报告 ——
  app.post('/api/cases/:id/run', async (req, reply) => {
    const tc = getCase(db, idParam(req))
    if (!tc) throw notFound('用例')
    const { env, resolve } = prepareEnv(parseEnvId((req.body as any)?.envId, envExists))
    const b = (req.body ?? {}) as { mutation?: unknown }
    if (b.mutation !== undefined && !isMutation(b.mutation)) throw new ValidationError('mutation 只能是 none / attr / style')
    const runId = createRun(db, tc, resolve(tc.url), { env, mutation: (b.mutation as Mutation) ?? 'none' })
    opts.executor.enqueue(runId)
    reply.status(202).send({ runId })
  })
  app.get('/api/runs', async (req) => {
    const q = req.query as { caseId?: string; limit?: string }
    return listRuns(db, { caseId: q.caseId ? Number(q.caseId) : undefined, limit: Math.min(Number(q.limit) || 50, 500) })
  })
  app.get('/api/stats', async (req) => {
    const q = req.query as { days?: string; caseId?: string }
    return getStats(db, { days: Math.min(Number(q.days) || 14, 365), caseId: q.caseId ? Number(q.caseId) : undefined })
  })
  app.get('/api/runs/:id', async (req) => getRun(db, idParam(req)) ?? Promise.reject(notFound('运行记录')))

  // —— 用例集与批量执行 ——
  const caseExists = (id: number) => getCase(db, id) !== null
  const startBatch = (name: string, caseIds: number[], suiteId: number | null, trigger: unknown, envId: number | null) => {
    const cases = caseIds.map((id) => getCase(db, id)).filter((c): c is NonNullable<typeof c> => c !== null)
    if (!cases.length) throw new ValidationError('用例集里的用例都已被删除')
    const { env, resolve } = prepareEnv(envId)
    cases.forEach((c) => resolve(c.url)) // 先整体校验变量，避免只创建了一半的运行
    const { batchId, runIds } = createBatch(db, {
      name,
      suiteId,
      trigger: trigger === 'ci' ? 'ci' : 'manual',
      items: cases.map((tc) => ({ tc })),
      resolveUrl: resolve,
      env,
    })
    runIds.forEach((id) => opts.executor.enqueue(id))
    return { batchId, runIds }
  }

  app.get('/api/suites', async () => listSuites(db))
  app.get('/api/suites/:id', async (req) => getSuite(db, idParam(req)) ?? Promise.reject(notFound('用例集')))
  app.post('/api/suites', async (req, reply) => reply.status(201).send(createSuite(db, validateSuite(req.body, caseExists, envExists))))
  app.put('/api/suites/:id', async (req) => updateSuite(db, idParam(req), validateSuite(req.body, caseExists, envExists)) ?? Promise.reject(notFound('用例集')))
  app.delete('/api/suites/:id', async (req, reply) => {
    if (!deleteSuite(db, idParam(req))) throw notFound('用例集')
    reply.status(204).send()
  })
  // 运行用例集；CI 调用时传 { "trigger": "ci" }；envId 不传则用用例集的默认环境
  app.post('/api/suites/:id/run', async (req, reply) => {
    const suite = getSuite(db, idParam(req))
    if (!suite) throw notFound('用例集')
    const body = (req.body ?? {}) as { trigger?: unknown; envId?: unknown }
    const envId = body.envId !== undefined ? parseEnvId(body.envId, envExists) : suite.envId && envExists(suite.envId) ? suite.envId : null
    reply.status(202).send(startBatch(suite.name, suite.caseIds, suite.id, body.trigger, envId))
  })
  // 临时批量运行：在用例列表勾选多个用例
  app.post('/api/batches', async (req, reply) => {
    const b = (req.body ?? {}) as { caseIds?: unknown; name?: unknown; trigger?: unknown; envId?: unknown }
    const ids = validateCaseIds(b.caseIds, caseExists)
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 100) : `批量运行（${ids.length} 个用例）`
    reply.status(202).send(startBatch(name, ids, null, b.trigger, parseEnvId(b.envId, envExists)))
  })
  // 鲁棒性对比：同一用例分别在“无变更 / 去掉测试标记 / 更换视觉样式”下运行，失败后继续执行，逐步对比
  app.post('/api/cases/:id/robustness', async (req, reply) => {
    const tc = getCase(db, idParam(req))
    if (!tc) throw notFound('用例')
    if (!tc.steps.some((s) => s.type !== 'api')) throw new ValidationError('纯接口用例没有页面，无法做界面变更对比')
    const { env, resolve } = prepareEnv(parseEnvId((req.body as any)?.envId, envExists))
    const { batchId, runIds } = createBatch(db, {
      name: `鲁棒性对比：${tc.name}`,
      kind: 'robustness',
      items: (['none', 'attr', 'style'] as const).map((mutation) => ({ tc, mutation, continueOnFailure: true })),
      resolveUrl: resolve,
      env,
    })
    runIds.forEach((id) => opts.executor.enqueue(id))
    reply.status(202).send({ batchId, runIds })
  })
  app.get('/api/batches', async () => listBatches(db))
  app.get('/api/batches/:id', async (req) => getBatch(db, idParam(req)) ?? Promise.reject(notFound('批次')))
  app.get('/api/batches/:id/junit', async (req, reply) => {
    const batch = getBatch(db, idParam(req))
    if (!batch) throw notFound('批次')
    const runs = batch.runs.map((r) => getRun(db, r.id)!)
    const origin = `${req.protocol}://${req.headers.host}`
    reply
      .type('application/xml; charset=utf-8')
      .header('content-disposition', `attachment; filename="batch-${batch.id}-junit.xml"`)
      .send(toJUnit(batch, runs, origin))
  })

  // —— AI 生成用例（只返回草稿，用户审核后再调用 POST /api/cases 入库）——
  app.post('/api/generate', async (req) => {
    const b = (req.body ?? {}) as { requirement?: unknown; url?: unknown }
    const requirement = typeof b.requirement === 'string' ? b.requirement.trim() : ''
    const url = typeof b.url === 'string' && b.url.trim() ? b.url.trim() : '{{DEMO}}/index.html'
    if (requirement.length < 10) throw new ValidationError('需求描述太短，请至少写 10 个字')
    if (requirement.length > 8000) throw new ValidationError('需求描述不能超过 8000 字')
    if (!isValidTargetUrl(url)) throw new ValidationError('目标 URL 不合法')
    const m = modelConfig()
    return generateDrafts(
      { configured: m.configured, baseUrl: m.baseUrl, apiKey: m.apiKey, model: m.genModel, timeoutMs: m.timeoutMs },
      requirement,
      url,
      opts.fetchImpl,
    )
  })

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist, prefix: '/', decorateReply: false, wildcard: false })
    // 前端路由回退到 index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        reply.type('text/html').send(fs.readFileSync(path.join(opts.webDist!, 'index.html')))
      } else reply.status(404).send({ error: '接口不存在' })
    })
  }

  return app
}
