// 探索接口：必须声明已授权、访客不能发起、配置里的口令不落盘、结果入库后可查询
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../server/app'
import { openDb } from '../../server/db'
import type { ExploreResult } from '../../server/explore/explorer'
import type { Executor } from '../../server/runner/executor'
import type { ExploreRunDetail } from '../../shared/types'

const result: ExploreResult = {
  stopReason: 'complete',
  clicks: 3,
  states: [
    { idx: 0, urlPattern: 'x.test/', fingerprint: 'a', title: '首页', depth: 0, reproducible: true, path: [] },
    { idx: 1, urlPattern: 'x.test/list', fingerprint: 'b', title: '列表', depth: 1, reproducible: true, path: [{ kind: 'click', selector: 'a', key: 'k1' }] },
  ],
  elements: [
    { key: 'k1', role: 'link', name: '列表', selector: 'a', tag: 'a', inputType: null, danger: null, clicked: true },
    { key: 'k2', role: 'button', name: '删除账号', selector: 'button', tag: 'button', inputType: null, danger: 'keyword', clicked: false },
  ],
  occurrences: [{ elementKey: 'k1', state: 0, count: 1 }, { elementKey: 'k2', state: 0, count: 1 }],
  transitions: [{ from: 0, elementKey: 'k1', action: 'click', to: 1, effect: 'navigated' }],
  blocked: [{ state: 0, url: 'http://x.test/api/save', method: 'POST', reason: 'write' }],
}

const make = async (access?: Parameters<typeof buildApp>[0]['access'], pending = 0) => {
  const seen: unknown[] = []
  const app = await buildApp({
    db: openDb(':memory:'),
    port: 1,
    artifactsDir: path.join(os.tmpdir(), 'atp-explore'),
    executor: { enqueue: () => 0, pending: () => pending } as unknown as Executor,
    access,
    runExplore: async (cfg) => {
      seen.push(cfg)
      return result
    },
  })
  return { app, seen }
}
const waitDone = async (app: Awaited<ReturnType<typeof make>>['app'], id: number) => {
  for (let i = 0; i < 50; i++) {
    const d = (await app.inject({ url: `/api/explore/runs/${id}` })).json() as ExploreRunDetail
    if (d.status !== 'running') return d
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('探索没有结束')
}

describe('探索接口', () => {
  it('不声明已授权就拒绝；声明后入库，口令不落盘，统计正确', async () => {
    const { app, seen } = await make()
    expect((await app.inject({ method: 'POST', url: '/api/explore', payload: { baseUrl: 'http://x.test/' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/explore', payload: { authorized: true, baseUrl: 'file:///etc/passwd' } })).statusCode).toBe(400)
    expect(seen).toHaveLength(0)

    const res = await app.inject({
      method: 'POST',
      url: '/api/explore',
      payload: { authorized: true, baseUrl: 'http://x.test/', setup: [{ type: 'fill', selector: '#pwd', value: 'super-secret' }, { type: 'click', selector: '#go' }] },
    })
    expect(res.statusCode).toBe(202)
    const d = await waitDone(app, res.json().id)
    expect(JSON.stringify(d)).not.toContain('super-secret')
    expect(JSON.stringify(seen)).toContain('super-secret') // 探索器拿得到，只是不落盘
    expect(d).toMatchObject({ status: 'done', stopReason: 'complete', stateCount: 2, elementCount: 2, dangerSkipped: 1, blockedCount: 1, clicks: 3 })
    expect(d.elements.find((e) => e.name === '删除账号')).toMatchObject({ danger: 'keyword', clicked: false })
    expect(d.transitions[0]).toMatchObject({ effect: 'navigated', action: 'click' })
    expect((await app.inject({ url: '/api/explore/runs' })).json()).toHaveLength(1)
    expect((await app.inject({ url: '/api/explore/runs/999' })).statusCode).toBe(404)
  })

  it('有用例在跑时返回 409；访客不能发起探索，也不触发探索器', async () => {
    const busy = await make(undefined, 1)
    expect((await busy.app.inject({ method: 'POST', url: '/api/explore', payload: { authorized: true } })).statusCode).toBe(409)
    expect(busy.seen).toHaveLength(0)

    const viewer = await make({ accessCode: 'c', publicDemo: true })
    const r = await viewer.app.inject({ method: 'POST', url: '/api/explore', payload: { authorized: true } })
    expect([r.statusCode, r.json().code]).toEqual([403, 'READ_ONLY'])
    expect(viewer.seen).toHaveLength(0)
    expect((await viewer.app.inject({ url: '/api/explore/runs' })).statusCode).toBe(200)
  })
})
