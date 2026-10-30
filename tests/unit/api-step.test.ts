import { describe, expect, it, vi } from 'vitest'
import { ApiStepError, checkMatcher, getPath, parseApiSpec, render, runApiStep } from '../../server/runner/api-step'

describe('parseApiSpec', () => {
  it('解析 YAML，方法默认 GET 并转大写', () => {
    expect(parseApiSpec('url: http://a.com')).toMatchObject({ method: 'GET', url: 'http://a.com' })
    expect(parseApiSpec('method: post\nurl: http://a.com').method).toBe('POST')
  })
  it.each([
    ['method: POST\nurl: [', 'YAML 格式错误'],
    ['- a\n- b', '需要是 YAML 对象'],
    ['method: FETCH\nurl: http://a', '不支持的请求方法'],
    ['method: GET', '缺少 url'],
    ['url: http://a\njson: {a: 1}\nbody: x', '只能二选一'],
    ['url: http://a\nextract: [a]', 'extract 需要是'],
  ])('非法定义 %#', (content, msg) => {
    expect(() => parseApiSpec(content)).toThrow(msg)
  })
})

describe('render', () => {
  const vars = { token: 'abc', id: 7, user: { name: 'demo' } }
  it('字符串内插、整串变量保留原类型、对象数组递归', () => {
    expect(render('Bearer {{token}}', vars)).toBe('Bearer abc')
    expect(render('{{id}}', vars)).toBe(7)
    expect(render({ a: ['/todos/{{ id }}', '{{user.name}}'] }, vars)).toEqual({ a: ['/todos/7', 'demo'] })
  })
  it('动态变量每次生成新值', () => {
    const a = render('stu{{$timestamp}}', {})
    expect(a).toMatch(/^stu\d{13}$/)
    expect(render('{{$randomInt}}', {})).toBeGreaterThanOrEqual(100000)
    expect(render('{{$uuid}}', {})).not.toBe(render('{{$uuid}}', {}))
  })

  it('未定义变量直接报错，而不是发出带 {{x}} 的请求', () => {
    expect(() => render('{{nope}}', vars)).toThrow('变量 {{nope}} 未定义')
    expect(() => render('a/{{nope}}', vars)).toThrow('未定义')
  })
})

describe('getPath', () => {
  const obj = { items: [{ text: 'a' }, { text: 'b' }], total: 2 }
  it.each([
    ['total', 2],
    ['items.1.text', 'b'],
    ['$.items[0].text', 'a'],
    ['items.length', 2],
    ['items.5.text', undefined],
    ['nope.deep', undefined],
  ])('%s', (path, expected) => expect(getPath(obj, path)).toEqual(expected))
})

describe('checkMatcher', () => {
  it.each([
    [1, 1, true],
    [{ a: 1 }, { a: 1 }, true],
    ['x', { eq: 'y' }, false],
    [undefined, { exists: false }, true],
    ['hello', { exists: true }, true],
    ['用户名或密码错误', { contains: '密码' }, true],
    [[{ id: 1, text: 'a' }], { contains: { text: 'a' } }, true],
    [[1, 2], { len: 2 }, true],
    [5, { gt: 3 }, true],
    [5, { lt: 3 }, false],
    [null, { type: 'null' }, true],
    [[], { type: 'array' }, true],
  ])('%j vs %j -> %s', (actual, m, ok) => {
    expect(checkMatcher('$', actual, m) === null).toBe(ok)
  })
})

describe('runApiStep', () => {
  const json = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

  it('渲染变量、发送 JSON、断言通过后提取变量', async () => {
    const f = json({ token: 't-1', user: { id: 9 } })
    const r = await runApiStep(
      `method: POST
url: "{{BASE}}/login"
headers: { Authorization: "Bearer {{old}}" }
query: { v: 2 }
json: { username: demo }
expect:
  status: [200, 201]
  json:
    token: { type: string }
    user.id: 9
extract:
  token: token
  uid: user.id`,
      { BASE: 'http://x.test', old: 'secret-token-value' },
      { timeoutMs: 1000, fetchImpl: f },
    )
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe('http://x.test/login?v=2')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"username":"demo"}')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(r.extracted).toEqual({ token: 't-1', uid: 9 })
    expect(r.request.headers.Authorization).toBe('Bearer secre***')
  })

  it('一次性列出所有断言失败，并附带请求 / 响应', async () => {
    const err = await runApiStep(
      'url: http://x.test\nexpect:\n  status: 200\n  bodyContains: ok\n  json:\n    a: 1\n    b: { exists: true }',
      {},
      { timeoutMs: 1000, fetchImpl: json({ a: 2 }, 500) },
    ).catch((e) => e)
    expect(err).toBeInstanceOf(ApiStepError)
    expect(err.message).toContain('状态码期望 200，实际 500')
    expect(err.message).toContain('响应体不包含 "ok"')
    expect(err.message).toContain('a 期望 1，实际 2')
    expect(err.message).toContain('b 期望存在')
    expect(err.result.response.status).toBe(500)
  })

  it('提取不到变量时失败', async () => {
    await expect(
      runApiStep('url: http://x.test\nextract: { token: data.token }', {}, { timeoutMs: 1000, fetchImpl: json({}) }),
    ).rejects.toThrow('提取变量 token 失败')
  })

  it('网络错误与超时给出可读信息', async () => {
    const refused = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    await expect(runApiStep('url: http://x.test', {}, { timeoutMs: 1000, fetchImpl: refused })).rejects.toThrow('请求失败：ECONNREFUSED')
    const slow = vi.fn(async (_u: unknown, init: RequestInit) => {
      await new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))))
      return new Response('')
    })
    await expect(runApiStep('url: http://x.test\ntimeoutMs: 20', {}, { timeoutMs: 1000, fetchImpl: slow as any })).rejects.toThrow('请求超时（20 ms）')
  })
})
