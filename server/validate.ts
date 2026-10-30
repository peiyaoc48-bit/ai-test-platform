import type { CaseInput, EnvironmentInput, Step, StepType } from '../shared/types.js'
import { parseApiSpec } from './runner/api-step.js'

const STEP_TYPES: StepType[] = ['ai_action', 'ai_assert', 'ai_query', 'code', 'api']

export class ValidationError extends Error {
  statusCode = 400
}

/** 校验并规整用例输入，返回干净的对象；不合法时抛出 ValidationError */
export function validateCase(body: unknown): CaseInput {
  if (!body || typeof body !== 'object') throw new ValidationError('请求体必须是对象')
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) throw new ValidationError('用例名称不能为空')
  if (name.length > 100) throw new ValidationError('用例名称不能超过 100 个字符')

  const url = typeof b.url === 'string' ? b.url.trim() : ''

  if (!Array.isArray(b.steps) || b.steps.length === 0) throw new ValidationError('至少需要一个步骤')
  if (b.steps.length > 50) throw new ValidationError('步骤不能超过 50 个')
  const steps: Step[] = b.steps.map((s, i) => {
    const step = s as Record<string, unknown>
    if (!STEP_TYPES.includes(step?.type as StepType)) throw new ValidationError(`第 ${i + 1} 步的类型不合法`)
    const content = typeof step.content === 'string' ? step.content.trim() : ''
    if (!content) throw new ValidationError(`第 ${i + 1} 步的内容不能为空`)
    if (step.type === 'api') {
      try {
        parseApiSpec(content)
      } catch (e: any) {
        throw new ValidationError(`第 ${i + 1} 步接口定义有误：${e.message}`)
      }
    }
    return { type: step.type as StepType, content }
  })

  // 纯接口用例不需要打开页面，URL 可以留空
  const needsPage = steps.some((s) => s.type !== 'api')
  if ((url || needsPage) && !isValidTargetUrl(url)) {
    throw new ValidationError('目标 URL 需以 http:// 或 https:// 开头，或使用 {{DEMO}} 占位符（纯接口用例可留空）')
  }

  const description = typeof b.description === 'string' ? b.description.trim() : ''
  return { name, description, url, steps }
}

/** 校验用例集输入；caseIds 去重并保持顺序 */
export function validateSuite(body: unknown, caseExists: (id: number) => boolean, envExists: (id: number) => boolean = () => true) {
  if (!body || typeof body !== 'object') throw new ValidationError('请求体必须是对象')
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) throw new ValidationError('用例集名称不能为空')
  if (name.length > 100) throw new ValidationError('用例集名称不能超过 100 个字符')
  const caseIds = validateCaseIds(b.caseIds, caseExists)
  const description = typeof b.description === 'string' ? b.description.trim() : ''
  const envId = parseEnvId(b.envId, envExists)
  return { name, description, caseIds, envId }
}

/** 可选的环境 id：空值表示不使用环境（默认演示站点） */
export function parseEnvId(raw: unknown, envExists: (id: number) => boolean): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('环境 id 不合法')
  if (!envExists(id)) throw new ValidationError(`环境 #${id} 不存在`)
  return id
}

export function validateCaseIds(raw: unknown, caseExists: (id: number) => boolean): number[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError('至少选择一个用例')
  if (raw.length > 200) throw new ValidationError('一次最多选择 200 个用例')
  const ids = [...new Set(raw)]
  for (const id of ids) {
    if (!Number.isInteger(id) || (id as number) <= 0) throw new ValidationError(`用例 id 不合法：${JSON.stringify(id)}`)
    if (!caseExists(id as number)) throw new ValidationError(`用例 #${id} 不存在`)
  }
  return ids as number[]
}

const PERMISSIONS = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write']
const RESERVED_VARS = ['DEMO', 'DEMO_API', 'BASE_URL']

const strMap = (raw: unknown, what: string, keyRe?: RegExp) => {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError(`${what}需要是“名称: 值”的对象`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (keyRe && !keyRe.test(k)) throw new ValidationError(`${what}名称不合法：${k}（只能用字母、数字、下划线，且不能以数字开头）`)
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new ValidationError(`${what} ${k} 的值必须是字符串`)
    out[k] = String(v)
  }
  return out
}

/** 校验并规整环境配置 */
export function validateEnvironment(body: unknown): EnvironmentInput {
  if (!body || typeof body !== 'object') throw new ValidationError('请求体必须是对象')
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) throw new ValidationError('环境名称不能为空')
  if (name.length > 50) throw new ValidationError('环境名称不能超过 50 个字符')

  const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : ''
  if (baseUrl && !/^https?:\/\//.test(baseUrl) && !/^\{\{\s*\w+\s*\}\}/.test(baseUrl)) {
    throw new ValidationError('基础地址需以 http:// 或 https:// 开头')
  }

  const vars = strMap(b.vars, '变量', /^[A-Za-z_]\w*$/)
  for (const k of Object.keys(vars)) {
    if (RESERVED_VARS.includes(k)) throw new ValidationError(`变量名 ${k} 是平台内置变量，不能覆盖`)
  }

  const launchArgs = b.launchArgs === undefined ? [] : b.launchArgs
  if (!Array.isArray(launchArgs) || launchArgs.some((a) => typeof a !== 'string' || !a.trim().startsWith('--'))) {
    throw new ValidationError('启动参数需要是以 -- 开头的字符串列表')
  }
  const permissions = b.permissions === undefined ? [] : b.permissions
  if (!Array.isArray(permissions) || permissions.some((p) => !PERMISSIONS.includes(p as string))) {
    throw new ValidationError(`权限只能是：${PERMISSIONS.join('、')}`)
  }

  let stepTimeoutMs: number | null = null
  if (b.stepTimeoutMs !== undefined && b.stepTimeoutMs !== null && b.stepTimeoutMs !== '') {
    stepTimeoutMs = Number(b.stepTimeoutMs)
    if (!Number.isInteger(stepTimeoutMs) || stepTimeoutMs < 1000 || stepTimeoutMs > 600_000) {
      throw new ValidationError('单步超时需在 1000 ~ 600000 毫秒之间')
    }
  }

  return {
    name,
    description: typeof b.description === 'string' ? b.description.trim() : '',
    baseUrl,
    vars,
    launchArgs: (launchArgs as string[]).map((a) => a.trim()),
    permissions: [...new Set(permissions as string[])],
    localStorage: strMap(b.localStorage, '本地存储'),
    stepTimeoutMs,
  }
}

export function isValidTargetUrl(url: string) {
  // 以变量开头（{{DEMO}}、{{BASE_URL}} 等），运行时再按环境解析
  if (/^\{\{\s*\w+\s*\}\}/.test(url)) return true
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 把 {{DEMO}} 占位符替换为演示站点地址 */
export function resolveUrl(url: string, demoBase: string) {
  return url.replace(/^\{\{DEMO\}\}/, demoBase.replace(/\/+$/, ''))
}
