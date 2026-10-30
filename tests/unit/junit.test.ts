import { describe, expect, it } from 'vitest'
import { toJUnit } from '../../server/report/junit'
import { deriveBatchStatus } from '../../server/repo/suites'
import { validateSuite, ValidationError } from '../../server/validate'
import type { BatchDetail, RunDetail, RunStatus } from '../../shared/types'

const run = (id: number, status: RunStatus, extra: Partial<RunDetail> = {}): RunDetail => ({
  id, caseId: id, caseName: `用例${id}`, status, startedAt: null, finishedAt: null, durationMs: 1500,
  passed: 0, failed: 0, skipped: 0, total: 1, aiCalls: 0, tokens: 0, url: '',
  steps: [{ index: 0, type: 'code', content: 'await page.click("a")\n第二行', status: status === 'failed' ? 'failed' : 'passed', durationMs: 10, aiCalls: 0, tokens: 0, error: status === 'failed' ? 'expect(locator).toHaveText <失败> & "引号"' : null }],
  ...extra,
})
const batch = { id: 3, name: '冒烟 <CI>', createdAt: '2026-10-30T00:00:00.000Z' } as BatchDetail

describe('toJUnit', () => {
  const xml = toJUnit(batch, [run(1, 'passed'), run(2, 'failed'), run(3, 'skipped'), run(4, 'error', { error: '打开目标页面失败' })], 'http://h')

  it('汇总计数与耗时', () => {
    expect(xml).toContain('<testsuites name="ai-test-platform" tests="4" failures="1" errors="1" skipped="1" time="6.000">')
  })
  it('失败 / 跳过 / 异常分别映射为 failure / skipped / error', () => {
    expect(xml).toContain('<failure message="第 1 步失败：expect(locator).toHaveText &lt;失败&gt; &amp; &quot;引号&quot;" type="StepFailed">')
    expect(xml).toContain('<skipped message="全部步骤被跳过（未配置模型）"/>')
    expect(xml).toContain('<error message="打开目标页面失败" type="RunError"/>')
  })
  it('转义特殊字符、去掉非法控制字符，并附上报告链接', () => {
    expect(xml).toContain('classname="冒烟 &lt;CI&gt;"')
    expect(toJUnit(batch, [run(5, 'passed', { caseName: 'a\u0001b' })])).toContain('name="ab"')
    expect(xml).toContain('报告：http://h/runs/1')
  })
})

describe('deriveBatchStatus', () => {
  it.each([
    [['passed', 'running'], 'running'],
    [['passed', 'queued'], 'running'],
    [['passed', 'error'], 'failed'],
    [['passed', 'skipped'], 'passed'],
    [['skipped', 'skipped'], 'skipped'],
    [[], 'skipped'],
  ] as const)('%j -> %s', (s, expected) => expect(deriveBatchStatus([...s])).toBe(expected))
})

describe('validateSuite', () => {
  const exists = (id: number) => id < 10
  it('去重并保持顺序', () => {
    expect(validateSuite({ name: ' 冒烟 ', caseIds: [3, 1, 3] }, exists)).toEqual({ name: '冒烟', description: '', caseIds: [3, 1], envId: null })
  })
  it.each([
    [{ name: '', caseIds: [1] }, '名称不能为空'],
    [{ name: 'a', caseIds: [] }, '至少选择一个用例'],
    [{ name: 'a', caseIds: [1.5] }, '用例 id 不合法'],
    [{ name: 'a', caseIds: ['1'] }, '用例 id 不合法'],
    [{ name: 'a', caseIds: [99] }, '用例 #99 不存在'],
  ])('非法输入 %#', (body, msg) => {
    expect(() => validateSuite(body, exists)).toThrow(ValidationError)
    expect(() => validateSuite(body, exists)).toThrow(msg)
  })
})
