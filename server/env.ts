import type { EnvSnapshot } from '../shared/types.js'
import { render } from './runner/api-step.js'
import { ValidationError } from './validate.js'

/** 平台内置变量，环境里不能同名覆盖 */
export const BUILTIN_VARS = ['DEMO', 'DEMO_API', 'BASE_URL']

/** 运行时可用的模板变量：内置演示地址 + 环境的 BASE_URL 和自定义变量 */
export function buildVars(builtin: Record<string, string>, env: EnvSnapshot | null): Record<string, string> {
  if (!env) return { ...builtin }
  return { ...env.vars, ...builtin, ...(env.baseUrl ? { BASE_URL: env.baseUrl.replace(/\/+$/, '') } : {}) }
}

/** 解析用例 URL 中的 {{变量}}；变量缺失时给出可操作的提示 */
export function resolveTemplate(text: string, vars: Record<string, string>, what = '目标 URL'): string {
  try {
    return render(text, vars)
  } catch (e: any) {
    throw new ValidationError(`${what}中的${e.message.replace(/^变量 /, '变量 ')}，请选择定义了该变量的环境`)
  }
}
