import { describe, expect, it } from 'vitest'
import { exportPlaywright, tplExpr } from '../../server/report/export'
import { SAMPLE_CASES } from '../../server/seed'
import type { TestCase } from '../../shared/types'

describe('tplExpr', () => {
  const fixed = { DEMO_API: 'http://h/demo-api' }
  it.each([
    ['plain', '"plain"'],
    ['{{DEMO_API}}/login', '"http://h/demo-api/login"'],
    ['{{token}}', 'vars.token'],
    ['Bearer {{token}}', '`Bearer ${vars.token}`'],
    ['stu{{$timestamp}}', '`stu${Date.now()}`'],
    ['价格 $5 与 `反引号` {{id}}', '`价格 \\$5 与 \\`反引号\\` ${vars.id}`'],
    [3, '3'],
    [{ a: ['{{x}}', true] }, '{ "a": [vars.x, true] }'],
  ])('%j', (input, expected) => expect(tplExpr(input, fixed)).toBe(expected))
})

describe('exportPlaywright', () => {
  const tc = (c: (typeof SAMPLE_CASES)[number], id = 1): TestCase => ({ ...c, id, createdAt: '', updatedAt: '' })

  it('纯代码用例：不引入 Midscene，代码原样输出', () => {
    const code = exportPlaywright(tc(SAMPLE_CASES[0]), { url: 'http://h/demo/index.html', env: null, fixedVars: {} })
    expect(code).toContain("import { expect, test } from '@playwright/test'")
    expect(code).not.toContain('midscene')
    expect(code).toContain('await page.goto("http://h/demo/index.html")')
    expect(code).toContain(SAMPLE_CASES[0].steps[0].content.split('\n')[0])
  })

  it('AI 步骤用 Midscene fixture，未配置模型时跳过；兜底翻译为 try / catch', () => {
    const code = exportPlaywright(
      tc({ ...SAMPLE_CASES[0], steps: [{ type: 'ai_assert', content: '有登录按钮' }, { type: 'code', content: 'await page.click("x")', fallback: { type: 'ai_action', content: '点击登录' } }] }),
      { url: 'http://h', env: null, fixedVars: {} },
    )
    expect(code).toContain("import { PlaywrightAiFixture } from '@midscene/web/playwright'")
    expect(code).toContain('if (hasModel) await aiAssert("有登录按钮")')
    expect(code).toMatch(/try \{\n\s+await page.click\("x"\)\n\s+\} catch \(e\) \{\n\s+if \(!hasModel\) throw e/)
    expect(code).toContain('await aiAct("点击登录")')
  })

  it('环境的启动参数、权限、本地存储与变量都被带出', () => {
    const env = { id: 1, name: '监考', description: '', baseUrl: 'http://w', vars: { API: 'http://a', V: '/v.y4m' }, launchArgs: ['--x={{V}}'], permissions: ['camera'], localStorage: { agreed: '1' }, stepTimeoutMs: 9000 }
    const code = exportPlaywright(tc(SAMPLE_CASES[3]), { url: '', env, fixedVars: { DEMO_API: 'http://h/demo-api', API: 'http://a' } })
    expect(code).toContain('test.use({ launchOptions: { args: ["--x=/v.y4m"] }, permissions: ["camera"] })')
    expect(code).toContain('{"agreed":"1"}')
    expect(code).toContain('"API": "http://a"')
    expect(code).toContain('page.setDefaultTimeout(9000)')
    expect(code).not.toContain('page.goto')
  })
})
