import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Role } from '../shared/types.js'

// 访问控制（部署到公网时使用）：
// - 未设置 ACCESS_CODE：本地开发，所有人都是管理员（默认行为不变）
// - 设置了 ACCESS_CODE：输入口令登录后为管理员；未登录时，若开启 PUBLIC_DEMO 则为只读访客，否则拒绝访问
// 只读访客可以查看一切、运行已有用例（受排队上限限制），但不能新建 / 修改 / 删除，也不能调用 AI 生成（会消耗 token）。

export interface AccessOptions {
  accessCode?: string
  publicDemo?: boolean
  secret?: string
  /** 访客触发运行时，执行队列的上限 */
  maxQueue?: number
  queueLength?: () => number
}

const COOKIE = 'atp_session'
const SESSION_DAYS = 7
/** 访客也允许调用的写接口：触发运行 */
const VIEWER_RUN_ROUTES = [/^\/api\/cases\/\d+\/run$/, /^\/api\/cases\/\d+\/robustness$/, /^\/api\/suites\/\d+\/run$/, /^\/api\/batches$/]

const httpError = (statusCode: number, message: string, code?: string) => Object.assign(new Error(message), { statusCode, code })

export function sign(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issueToken(secret: string, now = Date.now()) {
  const exp = String(now + SESSION_DAYS * 86_400_000)
  return `${exp}.${sign(secret, exp)}`
}

export function verifyToken(secret: string, token: string | undefined, now = Date.now()) {
  if (!token) return false
  const [exp, mac] = token.split('.')
  if (!exp || !mac || Number(exp) < now) return false
  const expected = Buffer.from(sign(secret, exp))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

const readCookie = (req: FastifyRequest, name: string) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim().split('='))
    .find(([k]) => k === name)?.[1]

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** 根据请求判断角色 */
export function roleOf(req: FastifyRequest, opts: AccessOptions, secret: string): Role {
  if (!opts.accessCode) return 'admin'
  if (verifyToken(secret, readCookie(req, COOKIE))) return 'admin'
  return opts.publicDemo ? 'viewer' : 'anonymous'
}

export function registerAccess(app: FastifyInstance, opts: AccessOptions) {
  const secret = opts.secret || randomBytes(32).toString('hex')
  const maxQueue = opts.maxQueue ?? 5
  // 简单的登录防爆破：每个 IP 10 分钟内最多 10 次失败
  const failures = new Map<string, { n: number; until: number }>()

  app.decorateRequest('role', 'admin')

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const role = roleOf(req, opts, secret)
    ;(req as any).role = role
    const url = req.url.split('?')[0]
    // 演示站点与其后端是被测对象，始终开放；前端页面自行处理登录
    if (url.startsWith('/demo/') || url.startsWith('/demo-api/') || url === '/demo') return
    if (url === '/api/login' || url === '/api/session' || url === '/api/logout') return
    const isApi = url.startsWith('/api/')
    const isArtifact = url.startsWith('/artifacts/') || url.startsWith('/midscene/')
    if (role === 'anonymous') {
      if (isApi || isArtifact) throw httpError(401, '请先输入访问口令', 'LOGIN_REQUIRED')
      return
    }
    if (role === 'viewer' && isApi && req.method !== 'GET') {
      if (!VIEWER_RUN_ROUTES.some((r) => r.test(url))) throw httpError(403, '演示站点为只读：可以查看和运行示例用例，登录后才能编辑', 'READ_ONLY')
      if ((opts.queueLength?.() ?? 0) >= maxQueue) throw httpError(429, '当前排队的运行较多，请稍后再试', 'QUEUE_FULL')
    }
  })

  app.get('/api/session', async (req) => ({
    role: (req as any).role as Role,
    authRequired: !!opts.accessCode,
    publicDemo: !!opts.publicDemo,
  }))

  app.post('/api/login', async (req, reply) => {
    if (!opts.accessCode) return { role: 'admin' }
    const ip = req.ip
    const f = failures.get(ip)
    if (f && f.n >= 10 && f.until > Date.now()) throw httpError(429, '尝试次数过多，请 10 分钟后再试')
    const code = (req.body as { code?: unknown } | undefined)?.code
    if (typeof code !== 'string' || !safeEqual(code, opts.accessCode)) {
      const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + 600_000 }
      failures.set(ip, { n: cur.n + 1, until: cur.until })
      throw httpError(401, '访问口令不正确')
    }
    failures.delete(ip)
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https'
    reply.header(
      'set-cookie',
      `${COOKIE}=${issueToken(secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`,
    )
    return { role: 'admin' }
  })

  app.post('/api/logout', async (_req, reply) => {
    reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return { role: opts.publicDemo ? 'viewer' : 'anonymous' }
  })
}
