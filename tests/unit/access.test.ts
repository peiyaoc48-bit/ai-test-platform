import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app'
import { openDb } from '../../server/db'
import { issueToken, verifyToken } from '../../server/access'
import { SAMPLE_CASES, seedIfEmpty } from '../../server/seed'
import type { Executor } from '../../server/runner/executor'

/** 不真正执行的假执行器：只记录入队，pending 可调 */
const fakeExecutor = (pending = 0) => {
  const enqueued: number[] = []
  return { enqueued, enqueue: (id: number) => enqueued.push(id), pending: () => pending } as unknown as Executor
}

async function make(access?: Parameters<typeof buildApp>[0]['access'], pending = 0) {
  const db = openDb(':memory:')
  seedIfEmpty(db)
  return buildApp({ db, port: 1, artifactsDir: path.join(os.tmpdir(), 'atp-access'), executor: fakeExecutor(pending), access })
}

describe('会话令牌', () => {
  it('签名正确且未过期才有效', () => {
    const t = issueToken('s1', 0)
    expect(verifyToken('s1', t, 1000)).toBe(true)
    expect(verifyToken('s2', t, 1000)).toBe(false)
    expect(verifyToken('s1', t, 8 * 86_400_000)).toBe(false) // 7 天后过期
    expect(verifyToken('s1', `${t}x`, 1000)).toBe(false)
    expect(verifyToken('s1', undefined)).toBe(false)
  })
})

describe('访问控制', () => {
  it('未设置口令时（本地开发）所有人都是管理员', async () => {
    const app = await make()
    expect((await app.inject({ url: '/api/session' })).json()).toMatchObject({ role: 'admin', authRequired: false })
    expect((await app.inject({ method: 'POST', url: '/api/cases', payload: SAMPLE_CASES[3] })).statusCode).toBe(201)
  })

  it('设置口令且不开放访客：未登录访问接口与截图返回 401，演示站点仍开放；登录后可编辑', async () => {
    const app = await make({ accessCode: 'open-sesame', secret: 'k' })
    expect((await app.inject({ url: '/api/cases' })).json().code).toBe('LOGIN_REQUIRED')
    expect((await app.inject({ url: '/artifacts/x.jpg' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/demo/index.html' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { code: 'wrong' } })).statusCode).toBe(401)

    const ok = await app.inject({ method: 'POST', url: '/api/login', payload: { code: 'open-sesame' }, headers: { 'x-forwarded-proto': 'https' } })
    const cookie = ok.headers['set-cookie'] as string
    expect(cookie).toMatch(/^atp_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/)
    const headers = { cookie: cookie.split(';')[0] }
    expect((await app.inject({ url: '/api/session', headers })).json().role).toBe('admin')
    expect((await app.inject({ method: 'POST', url: '/api/cases', payload: SAMPLE_CASES[3], headers })).statusCode).toBe(201)
  })

  it('开放访客：可查看与运行，不能编辑、不能调用 AI 生成；队列满时限流', async () => {
    const app = await make({ accessCode: 'c', publicDemo: true })
    expect((await app.inject({ url: '/api/session' })).json()).toMatchObject({ role: 'viewer', publicDemo: true })
    expect((await app.inject({ url: '/api/cases' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/cases/1/run', payload: {} })).statusCode).toBe(202)
    expect((await app.inject({ method: 'POST', url: '/api/suites/1/run', payload: {} })).statusCode).toBe(202)
    for (const [method, url] of [['POST', '/api/cases'], ['PUT', '/api/cases/1'], ['DELETE', '/api/cases/1'], ['POST', '/api/environments'], ['POST', '/api/generate'], ['DELETE', '/api/cases/1/ai-cache']] as const) {
      const r = await app.inject({ method, url, payload: {} })
      expect([r.statusCode, r.json().code], `${method} ${url}`).toEqual([403, 'READ_ONLY'])
    }
    const busy = await make({ accessCode: 'c', publicDemo: true, maxQueue: 5 }, 5)
    expect((await busy.inject({ method: 'POST', url: '/api/cases/1/run', payload: {} })).json().code).toBe('QUEUE_FULL')
  })

  it('同一 IP 连续输错 10 次后暂时锁定', async () => {
    const app = await make({ accessCode: 'right' })
    for (let i = 0; i < 10; i++) await app.inject({ method: 'POST', url: '/api/login', payload: { code: 'x' } })
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { code: 'right' } })
    expect(r.statusCode).toBe(429)
  })
})
