import { load as loadYaml } from 'js-yaml'

// 接口步骤：用 YAML 描述一次 HTTP 请求、断言和变量提取，例如
//
//   method: POST
//   url: "{{DEMO_API}}/login"
//   json: { username: demo, password: demo123 }
//   expect:
//     status: 200
//     maxMs: 500
//     json:
//       token: { exists: true }
//   extract:
//     token: token          # 存为 vars.token，后续步骤用 {{token}} 引用

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
type Method = (typeof METHODS)[number]

export type Matcher =
  | { eq: unknown }
  | { exists: boolean }
  | { contains: unknown }
  | { len: number }
  | { gt: number }
  | { lt: number }
  | { type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' }
  | unknown // 直接写值等价于 eq

export interface ApiSpec {
  method: Method
  url: string
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean>
  json?: unknown
  body?: string
  timeoutMs?: number
  expect?: {
    status?: number | number[]
    maxMs?: number
    headers?: Record<string, string>
    json?: Record<string, Matcher>
    bodyContains?: string
  }
  extract?: Record<string, string>
}

export interface ApiResult {
  request: { method: string; url: string; headers: Record<string, string>; body?: unknown }
  response: { status: number; ms: number; headers: Record<string, string>; body: unknown }
  extracted: Record<string, unknown>
}

export class ApiStepError extends Error {
  constructor(message: string, readonly result?: ApiResult) {
    super(message)
  }
}

/** 解析并校验步骤内容；保存用例时就会调用，语法错误能在编辑时发现 */
export function parseApiSpec(content: string): ApiSpec {
  let raw: any
  try {
    raw = loadYaml(content)
  } catch (e: any) {
    throw new Error(`YAML 格式错误：${e.reason ?? e.message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('接口步骤需要是 YAML 对象（method / url / expect …）')
  const method = String(raw.method ?? 'GET').toUpperCase()
  if (!METHODS.includes(method as Method)) throw new Error(`不支持的请求方法：${raw.method}`)
  if (typeof raw.url !== 'string' || !raw.url.trim()) throw new Error('缺少 url')
  if (raw.json !== undefined && raw.body !== undefined) throw new Error('json 和 body 只能二选一')
  if (raw.extract !== undefined && (typeof raw.extract !== 'object' || Array.isArray(raw.extract))) {
    throw new Error('extract 需要是“变量名: 路径”的映射')
  }
  return { ...raw, method }
}

/** 替换 {{变量}}：对象和数组递归处理；整串是单个变量时保留原类型 */
export function render<T>(value: T, vars: Record<string, unknown>): T {
  if (typeof value === 'string') {
    const whole = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(value)
    if (whole) {
      const v = getPath(vars, whole[1])
      if (v === undefined) throw new Error(`变量 {{${whole[1]}}} 未定义`)
      return v as T
    }
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name) => {
      const v = getPath(vars, name)
      if (v === undefined) throw new Error(`变量 {{${name}}} 未定义`)
      return typeof v === 'string' ? v : JSON.stringify(v)
    }) as T
  }
  if (Array.isArray(value)) return value.map((v) => render(v, vars)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, vars)])) as T
  }
  return value
}

/** 取值路径：支持 a.b.0.c、$.a.b[0].c、items.length */
export function getPath(obj: unknown, path: string): unknown {
  const keys = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: any = obj
  for (const k of keys) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[k]
  }
  return cur
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/** 单个字段断言，返回失败描述；通过时返回 null */
export function checkMatcher(path: string, actual: unknown, m: Matcher): string | null {
  const show = (v: unknown) => JSON.stringify(v)
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const [op, expected] = Object.entries(m)[0] ?? []
    switch (op) {
      case 'eq':
        return deepEqual(actual, expected) ? null : `${path} 期望 ${show(expected)}，实际 ${show(actual)}`
      case 'exists':
        return (actual !== undefined) === expected ? null : `${path} 期望${expected ? '存在' : '不存在'}，实际 ${show(actual)}`
      case 'contains':
        if (typeof actual === 'string') return actual.includes(String(expected)) ? null : `${path} 期望包含 ${show(expected)}，实际 ${show(actual)}`
        if (Array.isArray(actual)) return actual.some((a) => deepEqual(a, expected) || (isObj(expected) && isSubset(expected, a))) ? null : `${path} 期望包含 ${show(expected)}`
        return `${path} 不是字符串或数组，无法判断 contains`
      case 'len': {
        const len = (actual as any)?.length
        return len === expected ? null : `${path} 期望长度 ${expected}，实际 ${len}`
      }
      case 'gt':
        return typeof actual === 'number' && actual > (expected as number) ? null : `${path} 期望 > ${expected}，实际 ${show(actual)}`
      case 'lt':
        return typeof actual === 'number' && actual < (expected as number) ? null : `${path} 期望 < ${expected}，实际 ${show(actual)}`
      case 'type':
        return typeOf(actual) === expected ? null : `${path} 期望类型 ${expected}，实际 ${typeOf(actual)}`
    }
  }
  return deepEqual(actual, m) ? null : `${path} 期望 ${show(m)}，实际 ${show(actual)}`
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isSubset = (sub: Record<string, unknown>, obj: unknown) => isObj(obj) && Object.entries(sub).every(([k, v]) => deepEqual(obj[k], v))
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const MAX_BODY_CHARS = 4000

/** 执行接口步骤：渲染变量 → 发请求 → 断言 → 提取变量。断言失败时抛出带请求/响应信息的 ApiStepError */
export async function runApiStep(
  content: string,
  vars: Record<string, unknown>,
  opts: { timeoutMs: number; fetchImpl?: typeof fetch },
): Promise<ApiResult> {
  const spec = render(parseApiSpec(content), vars)
  const url = new URL(spec.url)
  for (const [k, v] of Object.entries(spec.query ?? {})) url.searchParams.set(k, String(v))
  const headers: Record<string, string> = { ...(spec.headers ?? {}) }
  let body: string | undefined
  if (spec.json !== undefined) {
    body = JSON.stringify(spec.json)
    headers['content-type'] ??= 'application/json'
  } else if (spec.body !== undefined) body = String(spec.body)

  const t0 = performance.now()
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      method: spec.method,
      headers,
      body,
      signal: AbortSignal.timeout(spec.timeoutMs ?? opts.timeoutMs),
    })
  } catch (e: any) {
    throw new Error(e?.name === 'TimeoutError' ? `请求超时（${spec.timeoutMs ?? opts.timeoutMs} ms）` : `请求失败：${e?.cause?.code ?? e?.message ?? e}`)
  }
  const text = await res.text()
  const ms = Math.round(performance.now() - t0)
  let resBody: unknown = text
  if ((res.headers.get('content-type') ?? '').includes('json') && text) {
    try {
      resBody = JSON.parse(text)
    } catch {
      /* 保留原文 */
    }
  }

  const result: ApiResult = {
    request: { method: spec.method, url: url.toString(), headers: maskHeaders(headers), body: spec.json ?? spec.body },
    response: {
      status: res.status,
      ms,
      headers: Object.fromEntries(res.headers.entries()),
      body: typeof resBody === 'string' && resBody.length > MAX_BODY_CHARS ? `${resBody.slice(0, MAX_BODY_CHARS)}…` : resBody,
    },
    extracted: {},
  }

  const failures: string[] = []
  const ex = spec.expect ?? {}
  const statuses = ex.status === undefined ? null : ([] as number[]).concat(ex.status)
  if (statuses && !statuses.includes(res.status)) failures.push(`状态码期望 ${statuses.join(' 或 ')}，实际 ${res.status}`)
  if (ex.maxMs !== undefined && ms > ex.maxMs) failures.push(`响应耗时 ${ms} ms，超过 ${ex.maxMs} ms`)
  for (const [name, expected] of Object.entries(ex.headers ?? {})) {
    const actual = res.headers.get(name) ?? ''
    if (!actual.includes(expected)) failures.push(`响应头 ${name} 期望包含 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
  if (ex.bodyContains !== undefined && !text.includes(ex.bodyContains)) failures.push(`响应体不包含 ${JSON.stringify(ex.bodyContains)}`)
  for (const [path, matcher] of Object.entries(ex.json ?? {})) {
    const f = checkMatcher(path, getPath(resBody, path), matcher)
    if (f) failures.push(f)
  }
  if (failures.length) throw new ApiStepError(`接口断言失败：\n- ${failures.join('\n- ')}`, result)

  for (const [name, path] of Object.entries(spec.extract ?? {})) {
    const v = getPath(resBody, path)
    if (v === undefined) throw new ApiStepError(`提取变量 ${name} 失败：响应中没有 ${path}`, result)
    result.extracted[name] = v
  }
  return result
}

/** 报告里不明文展示鉴权信息 */
function maskHeaders(h: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(h).map(([k, v]) => [k, /authorization|cookie|token|api-key/i.test(k) ? `${v.slice(0, 12)}***` : v]),
  )
}
