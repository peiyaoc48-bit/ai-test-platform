import type { CaseInput, Step, StepType } from '../shared/types.js'

const STEP_TYPES: StepType[] = ['ai_action', 'ai_assert', 'ai_query', 'code']

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
  if (!isValidTargetUrl(url)) throw new ValidationError('目标 URL 需以 http:// 或 https:// 开头，或使用 {{DEMO}} 占位符')

  if (!Array.isArray(b.steps) || b.steps.length === 0) throw new ValidationError('至少需要一个步骤')
  if (b.steps.length > 50) throw new ValidationError('步骤不能超过 50 个')
  const steps: Step[] = b.steps.map((s, i) => {
    const step = s as Record<string, unknown>
    if (!STEP_TYPES.includes(step?.type as StepType)) throw new ValidationError(`第 ${i + 1} 步的类型不合法`)
    const content = typeof step.content === 'string' ? step.content.trim() : ''
    if (!content) throw new ValidationError(`第 ${i + 1} 步的内容不能为空`)
    return { type: step.type as StepType, content }
  })

  const description = typeof b.description === 'string' ? b.description.trim() : ''
  return { name, description, url, steps }
}

export function isValidTargetUrl(url: string) {
  if (url.startsWith('{{DEMO}}')) return true
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
