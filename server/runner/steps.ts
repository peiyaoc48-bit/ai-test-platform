import type { Page } from 'playwright'
import { expect } from '@playwright/test'
import type { RunStatus, StepStatus } from '../../shared/types.js'

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>

export class StepTimeoutError extends Error {}

/** 在超时内执行 Promise，超时则抛出 StepTimeoutError */
export async function withTimeout<T>(p: Promise<T>, ms: number, label = '步骤'): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(`${label}超时（${ms} ms）`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 编译 Playwright 代码片段。片段以异步函数体执行，可用变量：page、expect、vars。
 * 注意：片段在平台进程内执行，仅适用于可信的内部用户（见 README 设计取舍）。
 */
export function compileSnippet(code: string) {
  try {
    return new AsyncFunction('page', 'expect', 'vars', code)
  } catch (e: any) {
    throw new Error(`代码语法错误：${e.message}`)
  }
}

export async function runCodeStep(code: string, page: Page, vars: Record<string, unknown>, timeoutMs: number) {
  const fn = compileSnippet(code)
  return withTimeout(fn(page, expect, vars), timeoutMs, '代码步骤')
}

const ANSI = /\u001b\[[0-9;]*m/g

/** 把异常整理成适合展示的简短信息 */
export function formatError(e: unknown, maxLen = 1200): string {
  const raw = e instanceof Error ? e.message : String(e)
  const msg = raw.replace(ANSI, '').replace(/\n{3,}/g, '\n\n').trim()
  return msg.length > maxLen ? `${msg.slice(0, maxLen)}…` : msg
}

/** 由各步骤状态得出运行结论：有失败即失败；部分跳过仍算通过；全部跳过记为跳过 */
export function deriveRunStatus(statuses: StepStatus[]): RunStatus {
  if (statuses.includes('failed')) return 'failed'
  if (statuses.some((s) => s === 'pending' || s === 'running' || s === 'not_run')) return 'error'
  if (statuses.length && statuses.every((s) => s === 'skipped')) return 'skipped'
  return 'passed'
}
