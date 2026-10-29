import { describe, expect, it } from 'vitest'
import { compileSnippet, deriveRunStatus, formatError, StepTimeoutError, withTimeout } from '../../server/runner/steps'

describe('deriveRunStatus', () => {
  it.each([
    [['passed', 'passed'], 'passed'],
    [['passed', 'skipped'], 'passed'],
    [['skipped', 'skipped'], 'skipped'],
    [['passed', 'failed', 'not_run'], 'failed'],
    [['passed', 'not_run'], 'error'],
    [[], 'passed'],
  ] as const)('%j -> %s', (statuses, expected) => {
    expect(deriveRunStatus([...statuses])).toBe(expected)
  })
})

describe('compileSnippet', () => {
  it('以异步函数体执行，可访问 page / expect / vars', async () => {
    const fn = compileSnippet('vars.out = page.n + 1; return await Promise.resolve(vars.out)')
    const vars: Record<string, unknown> = {}
    expect(await fn({ n: 41 }, null, vars)).toBe(42)
    expect(vars.out).toBe(42)
  })

  it('语法错误给出可读提示', () => {
    expect(() => compileSnippet('await page.click(')).toThrow(/^代码语法错误/)
  })
})

describe('withTimeout', () => {
  it('超时抛出 StepTimeoutError', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, '代码步骤')).rejects.toThrow(StepTimeoutError)
    await expect(withTimeout(new Promise(() => {}), 20, '代码步骤')).rejects.toThrow('代码步骤超时（20 ms）')
  })
  it('未超时返回结果', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 1000)).toBe('ok')
  })
})

describe('formatError', () => {
  it('去掉 ANSI 颜色并截断', () => {
    expect(formatError(new Error('\u001b[31mfailed\u001b[39m'))).toBe('failed')
    expect(formatError('x'.repeat(20), 10)).toBe(`${'x'.repeat(10)}…`)
  })
})
