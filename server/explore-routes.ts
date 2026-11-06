import type { FastifyInstance, FastifyRequest } from 'fastify'
import { chromium, type Browser } from 'playwright'
import { config, demoBaseUrl } from './config.js'
import type { DB } from './db.js'
import { type ExploreConfig, type ExploreResult, EXPLORE_DEFAULTS, explore } from './explore/explorer.js'
import { createExploreRun, failExploreRun, failStaleExploreRuns, getExploreRun, listExploreRuns, saveExploreResult } from './repo/explore.js'
import { ValidationError } from './validate.js'

export interface ExploreDeps {
  db: DB
  port: number
  idParam: (req: FastifyRequest) => number
  notFound: (what: string) => Error
  /** 执行队列里等待 / 正在运行的数量；有运行时不允许探索（共用一个浏览器的内存预算） */
  busy: () => boolean
  /** 测试时替换掉真实的探索器 */
  runExplore?: (cfg: ExploreConfig) => Promise<ExploreResult>
}

const int = (v: unknown, name: string, min: number, max: number, dflt: number) => {
  if (v === undefined || v === null || v === '') return dflt
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${name} 需要是 ${min}–${max} 的整数`)
  return n
}

/** 请求体 → 探索配置。必须声明“已获授权”，默认只允许 baseUrl 所在的主机 */
export function validateExplore(body: any, defaultBase: string): ExploreConfig {
  if (body?.authorized !== true) throw new ValidationError('请确认你有权对该系统做自动化探索（authorized: true）')
  const baseUrl = String(body.baseUrl ?? defaultBase).trim()
  let u: URL
  try {
    u = new URL(baseUrl)
  } catch {
    throw new ValidationError('baseUrl 不是合法的地址')
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ValidationError('baseUrl 只支持 http / https')
  const strList = (v: unknown, name: string) => {
    if (v === undefined) return undefined
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) throw new ValidationError(`${name} 必须是字符串数组`)
    return (v as string[]).map((x) => x.trim()).slice(0, 20)
  }
  if (body.setup !== undefined && !Array.isArray(body.setup)) throw new ValidationError('setup 必须是数组')
  const setup = (body.setup as any[] | undefined)?.slice(0, 10).map((s, i) => {
    if (!['fill', 'click'].includes(s?.type) || typeof s.selector !== 'string' || !s.selector) throw new ValidationError(`setup 第 ${i + 1} 步不合法`)
    return s.type === 'fill' ? { type: 'fill' as const, selector: s.selector, value: String(s.value ?? '') } : { type: 'click' as const, selector: s.selector }
  })
  return {
    baseUrl: u.toString(),
    allowedHosts: strList(body.allowedHosts, 'allowedHosts'),
    allowWrite: strList(body.allowWrite, 'allowWrite'),
    setup,
    maxStates: int(body.maxStates, 'maxStates', 1, 100, EXPLORE_DEFAULTS.maxStates),
    maxClicks: int(body.maxClicks, 'maxClicks', 1, 500, EXPLORE_DEFAULTS.maxClicks),
    maxDepth: int(body.maxDepth, 'maxDepth', 1, 8, EXPLORE_DEFAULTS.maxDepth),
    delayMs: int(body.delayMs, 'delayMs', 0, 5000, EXPLORE_DEFAULTS.delayMs),
  }
}

async function realExplore(cfg: ExploreConfig) {
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ channel: config.browserChannel || undefined, headless: config.headless })
    return await explore(browser, cfg)
  } finally {
    await browser?.close().catch(() => {})
  }
}

export function registerExplore(app: FastifyInstance, deps: ExploreDeps) {
  const { db } = deps
  failStaleExploreRuns(db)
  let running = false

  app.get('/api/explore/runs', async () => listExploreRuns(db))
  app.get('/api/explore/runs/:id', async (req) => getExploreRun(db, deps.idParam(req)) ?? Promise.reject(deps.notFound('探索记录')))

  // 写接口：访客的非 GET 请求已被 access 钩子拦截（READ_ONLY），不会走到这里
  app.post('/api/explore', async (req, reply) => {
    const cfg = validateExplore(req.body, `${demoBaseUrl(deps.port)}/index.html`)
    if (running || deps.busy()) throw Object.assign(new Error('当前有探索或用例在运行，请稍后再试'), { statusCode: 409, code: 'BUSY' })
    const id = createExploreRun(db, cfg)
    running = true
    void (deps.runExplore ?? realExplore)(cfg)
      .then((r) => saveExploreResult(db, id, r))
      .catch((e) => failExploreRun(db, id, e instanceof Error ? e.message : String(e)))
      .finally(() => {
        running = false
      })
    reply.status(202).send({ id })
  })
}
