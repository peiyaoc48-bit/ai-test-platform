import type { CaseInput } from '../shared/types.js'
import { createCase, countCases } from './repo/cases.js'
import { createSuite } from './repo/suites.js'
import type { DB } from './db.js'

/** 示例用例：针对自带演示站点 {{DEMO}}，覆盖纯选择器、混合、纯自然语言、纯接口四种写法 */
export const SAMPLE_CASES: CaseInput[] = [
  {
    name: '登录成功并添加待办（选择器）',
    description: '纯 Playwright 代码步骤，不依赖模型，可离线运行。',
    url: '{{DEMO}}/index.html',
    steps: [
      { type: 'code', content: `await page.fill('[data-test=username]', 'demo')\nawait page.fill('[data-test=password]', 'demo123')\nawait page.click('[data-test=submit]')` },
      { type: 'code', content: `await expect(page.locator('[data-test=welcome]')).toContainText('欢迎你，demo')` },
      { type: 'code', content: `await page.fill('[data-test=new-todo]', '提交周报')\nawait page.click('[data-test=add]')` },
      { type: 'code', content: `await expect(page.locator('[data-test=todo-item]')).toHaveCount(3)\nawait expect(page.locator('[data-test=summary]')).toHaveText('共 3 项，已完成 1 项')` },
    ],
  },
  {
    name: '错误密码提示（选择器 + 视觉断言）',
    description: '操作用选择器保证稳定，结果用视觉断言检查“看起来对不对”。',
    url: '{{DEMO}}/index.html',
    steps: [
      { type: 'code', content: `await page.fill('[data-test=username]', 'demo')\nawait page.fill('[data-test=password]', 'wrong')\nawait page.click('[data-test=submit]')` },
      { type: 'code', content: `await expect(page.locator('[data-test=error]')).toHaveText('用户名或密码错误')` },
      { type: 'ai_assert', content: '登录按钮下方出现红色的错误提示“用户名或密码错误”，页面仍停留在登录页' },
    ],
  },
  {
    name: '待办增删（自然语言）',
    description: '全部步骤用自然语言描述，由 Midscene 视觉模型执行；未配置模型时会被跳过。',
    url: '{{DEMO}}/index.html',
    steps: [
      { type: 'ai_action', content: '在用户名输入框输入 demo，密码输入框输入 demo123，然后点击登录按钮' },
      { type: 'ai_assert', content: '页面标题显示“欢迎你，demo”' },
      { type: 'ai_action', content: '在“今天要做什么？”输入框中输入“买牛奶”并点击添加' },
      { type: 'ai_action', content: '删除“阅读 Playwright 文档”这一条待办' },
      { type: 'ai_query', content: 'string[]，列表中所有待办事项的文字' },
      { type: 'ai_assert', content: '待办列表中有“买牛奶”，且没有“阅读 Playwright 文档”' },
    ],
  },
  {
    name: '待办接口：登录 → 增删改查（接口）',
    description: '纯接口用例，不打开浏览器：登录拿 token，带 token 调用待办接口，验证鉴权、增删改查与统计。',
    url: '',
    steps: [
      { type: 'api', content: `method: POST
url: "{{DEMO_API}}/login"
json: { username: demo, password: demo123 }
expect:
  status: 200
  maxMs: 500
  json:
    token: { type: string }
    username: demo
extract:
  token: token` },
      { type: 'api', content: `# 不带 token 应被拒绝
method: GET
url: "{{DEMO_API}}/todos"
expect:
  status: 401
  json:
    error: { contains: 未登录 }` },
      { type: 'api', content: `method: POST
url: "{{DEMO_API}}/todos"
headers: { Authorization: "Bearer {{token}}" }
json: { text: 接口新增的待办 }
expect:
  status: 201
  json:
    done: false
    text: 接口新增的待办
extract:
  todoId: id` },
      { type: 'api', content: `method: PATCH
url: "{{DEMO_API}}/todos/{{todoId}}"
headers: { Authorization: "Bearer {{token}}" }
json: { done: true }
expect:
  status: 200
  json:
    done: true` },
      { type: 'api', content: `method: GET
url: "{{DEMO_API}}/todos"
headers: { Authorization: "Bearer {{token}}" }
expect:
  status: 200
  json:
    total: 3
    done: 2
    items: { contains: { text: 接口新增的待办, done: true } }` },
      { type: 'api', content: `method: DELETE
url: "{{DEMO_API}}/todos/{{todoId}}"
headers: { Authorization: "Bearer {{token}}" }
expect:
  status: 204` },
    ],
  },
]

export function seedIfEmpty(db: DB) {
  if (countCases(db) > 0) return
  const ids = SAMPLE_CASES.map((c) => createCase(db, c).id)
  // 默认“冒烟”用例集：不依赖模型的三条用例（选择器、选择器 + 视觉断言、纯接口），CI 中用它做回归
  createSuite(db, { name: '冒烟', description: '离线可跑的核心链路，CI 默认执行', caseIds: [ids[0], ids[1], ids[3]], envId: null })
}
