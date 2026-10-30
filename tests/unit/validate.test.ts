import { describe, expect, it } from 'vitest'
import { isValidTargetUrl, resolveUrl, validateCase, validateEnvironment, ValidationError } from '../../server/validate'
import { buildVars } from '../../server/env'

const ok = { name: ' 登录 ', url: '{{DEMO}}/index.html', steps: [{ type: 'code', content: ' await page.click("a") ' }] }

describe('validateCase', () => {
  it('规整合法输入：去掉首尾空白、补默认描述', () => {
    expect(validateCase(ok)).toEqual({
      name: '登录',
      description: '',
      url: '{{DEMO}}/index.html',
      steps: [{ type: 'code', content: 'await page.click("a")' }],
    })
  })

  it.each([
    [{ ...ok, name: '  ' }, '用例名称不能为空'],
    [{ ...ok, name: 'x'.repeat(101) }, '不能超过 100'],
    [{ ...ok, url: 'ftp://a.com' }, '目标 URL'],
    [{ ...ok, url: 'javascript:alert(1)' }, '目标 URL'],
    [{ ...ok, steps: [] }, '至少需要一个步骤'],
    [{ ...ok, steps: [{ type: 'shell', content: 'rm -rf /' }] }, '第 1 步的类型不合法'],
    [{ ...ok, steps: [ok.steps[0], { type: 'ai_assert', content: ' ' }] }, '第 2 步的内容不能为空'],
    [null, '请求体必须是对象'],
  ])('拒绝非法输入 %#', (input, msg) => {
    expect(() => validateCase(input)).toThrow(ValidationError)
    expect(() => validateCase(input)).toThrow(msg)
  })

  it('纯接口用例 URL 可以为空；含页面步骤时 URL 必填', () => {
    const api = { type: 'api', content: 'url: http://a.com' }
    expect(validateCase({ name: 'x', url: '', steps: [api] }).url).toBe('')
    expect(() => validateCase({ name: 'x', url: '', steps: [api, ok.steps[0]] })).toThrow('目标 URL')
    expect(() => validateCase({ name: 'x', url: 'ftp://a', steps: [api] })).toThrow('目标 URL')
  })

  it('保存时校验接口步骤的 YAML', () => {
    expect(() => validateCase({ ...ok, steps: [{ type: 'api', content: 'method: GET' }] })).toThrow('第 1 步接口定义有误：缺少 url')
  })

  it('最多 50 步', () => {
    const steps = Array.from({ length: 51 }, () => ({ type: 'ai_action', content: '点击' }))
    expect(() => validateCase({ ...ok, steps })).toThrow('不能超过 50')
  })
})

describe('URL 处理', () => {
  it('只接受 http(s) 与 {{DEMO}} 占位符', () => {
    expect(isValidTargetUrl('https://example.com/a?b=1')).toBe(true)
    expect(isValidTargetUrl('{{DEMO}}/todos.html')).toBe(true)
    expect(isValidTargetUrl('file:///etc/passwd')).toBe(false)
    expect(isValidTargetUrl('not a url')).toBe(false)
  })

  it('替换开头的 {{DEMO}}，并去掉多余斜杠', () => {
    expect(resolveUrl('{{DEMO}}/index.html', 'http://127.0.0.1:3100/demo/')).toBe('http://127.0.0.1:3100/demo/index.html')
    expect(resolveUrl('https://a.com/{{DEMO}}', 'http://x')).toBe('https://a.com/{{DEMO}}')
  })
})

describe('validateEnvironment', () => {
  it('规整输入：去空白、权限去重、数字值转字符串', () => {
    expect(
      validateEnvironment({
        name: ' 监考 ',
        baseUrl: 'http://localhost:5174',
        vars: { API: 'http://localhost:8081', RETRY: 3 },
        launchArgs: [' --use-fake-device-for-media-stream '],
        permissions: ['camera', 'camera'],
        localStorage: { agreed: '1' },
        stepTimeoutMs: '90000',
      }),
    ).toEqual({
      name: '监考',
      description: '',
      baseUrl: 'http://localhost:5174',
      vars: { API: 'http://localhost:8081', RETRY: '3' },
      launchArgs: ['--use-fake-device-for-media-stream'],
      permissions: ['camera'],
      localStorage: { agreed: '1' },
      stepTimeoutMs: 90000,
    })
  })
  it.each([
    [{ name: '' }, '环境名称不能为空'],
    [{ name: 'a', baseUrl: 'localhost:5174' }, '基础地址'],
    [{ name: 'a', vars: { '1x': 'v' } }, '变量名称不合法'],
    [{ name: 'a', vars: { DEMO: 'v' } }, '内置变量'],
    [{ name: 'a', vars: ['x'] }, '对象'],
    [{ name: 'a', launchArgs: ['use-gl'] }, '以 -- 开头'],
    [{ name: 'a', permissions: ['root'] }, '权限只能是'],
    [{ name: 'a', stepTimeoutMs: 10 }, '1000 ~ 600000'],
  ])('非法输入 %#', (body, msg) => expect(() => validateEnvironment(body)).toThrow(msg))
})

describe('buildVars', () => {
  it('内置变量优先，BASE_URL 去掉末尾斜杠；未配置基础地址时不提供 BASE_URL', () => {
    const env = { id: 1, name: 'e', description: '', baseUrl: 'http://a.test/', vars: { API: 'x' }, launchArgs: [], permissions: [], localStorage: {}, stepTimeoutMs: null }
    expect(buildVars({ DEMO: 'd' }, env)).toEqual({ API: 'x', DEMO: 'd', BASE_URL: 'http://a.test' })
    expect(buildVars({ DEMO: 'd' }, { ...env, baseUrl: '' })).not.toHaveProperty('BASE_URL')
    expect(buildVars({ DEMO: 'd' }, null)).toEqual({ DEMO: 'd' })
  })
})
