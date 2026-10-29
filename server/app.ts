import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { PlatformConfig } from '../shared/types.js'
import { demoBaseUrl, modelConfig } from './config.js'
import type { DB } from './db.js'
import { createCase, deleteCase, getCase, listCases, updateCase } from './repo/cases.js'
import { validateCase, ValidationError } from './validate.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface AppOptions {
  db: DB
  port: number
  artifactsDir: string
  /** 生产模式下托管前端构建产物 */
  webDist?: string
  logger?: boolean
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
  fs.mkdirSync(opts.artifactsDir, { recursive: true })
  await app.register(fastifyStatic, { root: opts.artifactsDir, prefix: '/artifacts/', decorateReply: false })

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

  // —— 用例管理 ——
  app.get('/api/cases', async () => listCases(db))
  app.get('/api/cases/:id', async (req) => getCase(db, idParam(req)) ?? Promise.reject(notFound('用例')))
  app.post('/api/cases', async (req, reply) => reply.status(201).send(createCase(db, validateCase(req.body))))
  app.put('/api/cases/:id', async (req) => updateCase(db, idParam(req), validateCase(req.body)) ?? Promise.reject(notFound('用例')))
  app.delete('/api/cases/:id', async (req, reply) => {
    if (!deleteCase(db, idParam(req))) throw notFound('用例')
    reply.status(204).send()
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
