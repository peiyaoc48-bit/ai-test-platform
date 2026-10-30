import type { EnvSnapshot, Step, TestCase } from '../../shared/types.js'
import { STEP_TYPE_LABEL } from '../../shared/types.js'
import { type ApiSpec, type Matcher, parseApiSpec } from '../runner/api-step.js'

// 把平台用例导出为可以独立运行的 Playwright 测试文件（.spec.ts），落实“稳定后沉淀为脚本”。
// - 代码步骤原样输出；AI 步骤使用 Midscene 的 Playwright fixture（aiAct / aiAssert / aiQuery）
// - 接口步骤翻译成 Playwright 的 request 调用 + expect 断言，提取的变量放在 vars 里
// - 环境的启动参数、权限、预置 localStorage 转成 test.use / addInitScript

const q = (s: string) => JSON.stringify(s)
const indent = (code: string, pad = '  ') => code.split('\n').map((l) => (l ? pad + l : l)).join('\n')

/** 把含 {{变量}} 的值转成 JS 表达式：整串单变量保留原类型，否则用模板字符串 */
export function tplExpr(value: unknown, fixed: Record<string, string>): string {
  if (typeof value === 'string') {
    const ref = (name: string) =>
      name === '$timestamp' ? 'Date.now()' : name === '$randomInt' ? 'Math.floor(Math.random() * 900000 + 100000)' : name === '$uuid' ? 'crypto.randomUUID()'
        : name in fixed ? q(fixed[name]) : `vars.${name}`
    const whole = /^\{\{\s*(\$?[\w.]+)\s*\}\}$/.exec(value)
    if (whole) return ref(whole[1])
    // 先代入写死的内置变量；剩下的运行时变量用模板字符串
    const inlined = value.replace(/\{\{\s*(\$?[\w.]+)\s*\}\}/g, (m, n) => (n in fixed ? fixed[n] : m))
    if (!/\{\{/.test(inlined)) return q(inlined)
    // 只转义字面量部分；占位符替换成 ${表达式}（先转义再替换会把 {{$timestamp}} 里的 $ 也转义掉）
    const body = inlined
      .split(/(\{\{\s*\$?[\w.]+\s*\}\})/)
      .map((part) => {
        const m = /^\{\{\s*(\$?[\w.]+)\s*\}\}$/.exec(part)
        return m ? `\${${ref(m[1])}}` : part.replace(/[`\\$]/g, '\\$&')
      })
      .join('')
    return '`' + body + '`'
  }
  if (Array.isArray(value)) return `[${value.map((v) => tplExpr(v, fixed)).join(', ')}]`
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([k, v]) => `${q(k)}: ${tplExpr(v, fixed)}`).join(', ')} }`
  }
  return JSON.stringify(value)
}

function matcherExpr(actual: string, m: Matcher, fixed: Record<string, string>): string {
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const [op, v] = Object.entries(m)[0] ?? []
    switch (op) {
      case 'eq': return `expect(${actual}).toEqual(${tplExpr(v, fixed)})`
      case 'exists': return v ? `expect(${actual}).toBeDefined()` : `expect(${actual}).toBeUndefined()`
      case 'contains':
        return v && typeof v === 'object'
          ? `expect(${actual}).toContainEqual(expect.objectContaining(${tplExpr(v, fixed)}))`
          : `expect(${actual}).toContain(${tplExpr(v, fixed)})`
      case 'len': return `expect(${actual}).toHaveLength(${JSON.stringify(v)})`
      case 'gt': return `expect(${actual}).toBeGreaterThan(${JSON.stringify(v)})`
      case 'lt': return `expect(${actual}).toBeLessThan(${JSON.stringify(v)})`
      case 'type': return v === 'array' ? `expect(Array.isArray(${actual})).toBe(true)` : v === 'null' ? `expect(${actual}).toBeNull()` : `expect(typeof ${actual}).toBe(${q(String(v))})`
    }
  }
  return `expect(${actual}).toEqual(${tplExpr(m, fixed)})`
}

function apiStepCode(spec: ApiSpec, fixed: Record<string, string>): string {
  const lines: string[] = []
  const opts: string[] = []
  if (spec.headers) opts.push(`headers: ${tplExpr(spec.headers, fixed)}`)
  if (spec.query) opts.push(`params: ${tplExpr(spec.query, fixed)}`)
  if (spec.json !== undefined) opts.push(`data: ${tplExpr(spec.json, fixed)}`)
  if (spec.body !== undefined) opts.push(`data: ${tplExpr(spec.body, fixed)}`)
  if (spec.expect?.maxMs !== undefined) lines.push('const t0 = Date.now()')
  lines.push(`const res = await request.fetch(${tplExpr(spec.url, fixed)}, { method: ${q(spec.method)}${opts.length ? ', ' + opts.join(', ') : ''} })`)
  const ex = spec.expect ?? {}
  if (ex.maxMs !== undefined) lines.push(`expect(Date.now() - t0).toBeLessThanOrEqual(${ex.maxMs})`)
  if (ex.status !== undefined) {
    lines.push(Array.isArray(ex.status) ? `expect(${JSON.stringify(ex.status)}).toContain(res.status())` : `expect(res.status()).toBe(${ex.status})`)
  }
  for (const [h, v] of Object.entries(ex.headers ?? {})) lines.push(`expect(res.headers()[${q(h.toLowerCase())}]).toContain(${tplExpr(v, fixed)})`)
  const needsText = ex.bodyContains !== undefined
  const needsJson = Object.keys(ex.json ?? {}).length > 0 || Object.keys(spec.extract ?? {}).length > 0
  if (needsText || needsJson) lines.push('const text = await res.text()')
  if (needsText) lines.push(`expect(text).toContain(${tplExpr(ex.bodyContains, fixed)})`)
  if (needsJson) lines.push('const body = text ? JSON.parse(text) : undefined')
  for (const [path, m] of Object.entries(ex.json ?? {})) lines.push(matcherExpr(`get(body, ${q(path)})`, m, fixed))
  for (const [name, path] of Object.entries(spec.extract ?? {})) lines.push(`vars.${name} = get(body, ${q(path)})`)
  return `{\n${indent(lines.join('\n'))}\n}`
}

function stepCode(step: Step, i: number, fixed: Record<string, string>): string {
  const head = `// 步骤 ${i + 1}：${STEP_TYPE_LABEL[step.type]}`
  switch (step.type) {
    case 'code':
      if (step.fallback) {
        const fb = step.fallback.type === 'ai_assert' ? 'aiAssert' : 'aiAct'
        return `${head}（选择器失效时由 AI 兜底）\ntry {\n${indent(step.content)}\n} catch (e) {\n  if (!hasModel) throw e\n  console.warn('第 ${i + 1} 步选择器失效，改用 AI 兜底：', e)\n  await ${fb}(${q(step.fallback.content)})\n}`
      }
      return `${head}\n${step.content}`
    case 'ai_action':
      return `${head}\nif (hasModel) await aiAct(${q(step.content)})`
    case 'ai_assert':
      return `${head}\nif (hasModel) await aiAssert(${q(step.content)})`
    case 'ai_query':
      return `${head}\nif (hasModel) vars.step${i + 1} = await aiQuery(${q(step.content)})`
    case 'api':
      return `${head}\n${apiStepCode(parseApiSpec(step.content), fixed)}`
  }
}

export function exportPlaywright(tc: TestCase, opts: { url: string; env: EnvSnapshot | null; fixedVars: Record<string, string> }): string {
  const { env } = opts
  const usesAi = tc.steps.some((s) => s.type.startsWith('ai_') || s.fallback)
  const usesPage = tc.steps.some((s) => s.type !== 'api')
  const usesApi = tc.steps.some((s) => s.type === 'api')
  // 内置变量（DEMO、BASE_URL 等）在导出时写死为当前环境的值；环境自定义变量放进 vars，方便修改
  const fixed = { ...opts.fixedVars }
  const envVars = env?.vars ?? {}
  for (const k of Object.keys(envVars)) delete fixed[k]

  const fixtures = [...(usesPage || env?.stepTimeoutMs ? ['page'] : []), ...(usesApi ? ['request'] : []), ...(usesAi ? ['aiAct', 'aiAssert', 'aiQuery'] : [])]
  const use: string[] = []
  if (env?.launchArgs.length) use.push(`launchOptions: { args: ${JSON.stringify(env.launchArgs.map((a) => a.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, n) => envVars[n] ?? fixed[n] ?? m)))} }`)
  if (env?.permissions.length) use.push(`permissions: ${JSON.stringify(env.permissions)}`)

  const out: string[] = []
  out.push(`// 由 AI UI 自动化测试平台导出：${tc.name}`)
  if (tc.description) out.push(`// ${tc.description.replace(/\n/g, ' ')}`)
  out.push(`// 环境：${env?.name ?? '默认（演示站点）'}；导出时间：${new Date().toISOString()}`)
  if (usesAi) out.push('// AI 步骤依赖 Midscene，需要在环境变量中配置 MIDSCENE_MODEL_*')
  out.push(
    usesAi
      ? "import { test as base, expect } from '@playwright/test'\nimport { PlaywrightAiFixture } from '@midscene/web/playwright'\n\nconst test = base.extend(PlaywrightAiFixture())\n// 与平台一致：未配置模型时跳过 AI 步骤\nconst hasModel = !!process.env.MIDSCENE_MODEL_API_KEY"
      : "import { expect, test } from '@playwright/test'",
  )
  out.push('')
  if (use.length) out.push(`test.use({ ${use.join(', ')} })\n`)
  if (env && Object.keys(env.localStorage).length) {
    out.push(`// 预置 localStorage（页面脚本执行前写入）\ntest.beforeEach(async ({ context }) => {\n  await context.addInitScript((items) => {\n    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v)\n  }, ${JSON.stringify(env.localStorage)})\n})\n`)
  }
  if (usesApi) out.push(`/** 按路径取值：a.b.0.c / $.a.b[0].c */\nconst get = (obj: any, path: string) =>\n  path.replace(/^\\$\\.?/, '').replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj)\n`)
  out.push(`test(${q(tc.name)}, async ({ ${fixtures.join(', ')} }) => {`)
  if (env?.stepTimeoutMs) out.push(`  test.setTimeout(${env.stepTimeoutMs * Math.max(2, tc.steps.length)})\n  page.setDefaultTimeout(${env.stepTimeoutMs})`)
  out.push(`  const vars: Record<string, any> = ${JSON.stringify(envVars, null, 2).replace(/\n/g, '\n  ')}`)
  if (usesPage && opts.url) out.push(`  await page.goto(${q(opts.url)})`)
  for (const [i, s] of tc.steps.entries()) out.push('', indent(stepCode(s, i, fixed)))
  out.push('})', '')
  return out.join('\n')
}
