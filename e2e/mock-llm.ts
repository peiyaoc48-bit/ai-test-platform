// E2E 用的假大模型：实现 OpenAI 兼容的 /v1/chat/completions，按系统提示词返回固定内容：
// - 快速生成：两条用例草稿
// - 用例工坊解析：TodoLite 需求的 4 个需求点（第 4 个的摘录是编造的，用于验证“摘录找不到”的提示）
// - 用例工坊生成：按用户消息里出现的需求点编号返回用例，每条标注覆盖的需求点与置信度
// 只用于平台自身的端到端测试，不代表真实模型的生成效果。
import http from 'node:http'

const port = Number(process.env.MOCK_LLM_PORT || 3297)

const quickDrafts = {
  cases: [
    {
      name: '正确账号登录进入待办页',
      description: '主流程（假模型生成）',
      steps: [
        { type: 'ai_action', content: '在用户名输入框输入 demo，密码输入框输入 demo123，点击登录' },
        { type: 'ai_assert', content: '页面标题显示“欢迎你，demo”' },
      ],
    },
    {
      name: '密码错误时提示',
      description: '异常场景（假模型生成）',
      steps: [
        { type: 'ai_action', content: '输入用户名 demo、密码 wrong 后点击登录' },
        { type: 'ai_assert', content: '登录按钮下方出现“用户名或密码错误”' },
      ],
    },
  ],
}

const points = {
  points: [
    { title: '正确账号登录后进入“我的待办”页并显示欢迎语', priority: 'P0', excerpt: '账号正确时进入“我的待办”页，标题显示“欢迎你，<用户名>”' },
    { title: '用户名或密码错误时提示“用户名或密码错误”', priority: 'P1', excerpt: '在登录按钮下方显示红色提示“用户名或密码错误”' },
    { title: '输入内容后点击“添加”新增待办', priority: 'P0', excerpt: '在输入框输入内容后点击“添加”新增待办' },
    { title: '连续三次输错密码锁定账号', priority: 'P2', excerpt: '连续三次输错密码后锁定账号 10 分钟' },
  ],
}

const CASES_BY_POINT: Record<string, object> = {
  'REQ-001': {
    name: '正确账号登录显示欢迎语',
    description: '主流程（假模型生成）',
    points: ['REQ-001'],
    confidence: 0.92,
    steps: [
      { type: 'ai_action', content: '在用户名输入框输入 demo，密码输入框输入 demo123，点击登录' },
      { type: 'ai_assert', content: '页面标题显示“欢迎你，demo”' },
    ],
  },
  'REQ-002': {
    name: '密码错误时提示',
    description: '异常场景（假模型生成）',
    points: ['REQ-002'],
    confidence: 0.55,
    steps: [
      { type: 'ai_action', content: '输入用户名 demo、密码 wrong 后点击登录' },
      { type: 'ai_assert', content: '页面提示操作失败' },
    ],
  },
  'REQ-003': {
    name: '登录后新增待办',
    description: '主流程（假模型生成）',
    points: ['REQ-001', 'REQ-003'],
    confidence: 0.38,
    steps: [
      { type: 'ai_action', content: '用 demo / demo123 登录' },
      { type: 'ai_action', content: '在输入框输入“买牛奶”并点击添加' },
      { type: 'ai_assert', content: '待办列表中出现“买牛奶”' },
    ],
  },
  'REQ-004': {
    name: '连续输错三次密码被锁定',
    description: '需确认：锁定文案（假模型生成）',
    points: ['REQ-004'],
    confidence: 0.2,
    steps: [
      { type: 'ai_action', content: '连续三次输入错误密码并点击登录' },
      { type: 'ai_assert', content: '页面提示账号已锁定' },
    ],
  },
}

function reply(system: string, user: string) {
  if (system.includes('需求点”') && system.includes('excerpt')) return points
  if (system.includes('"points":["REQ-001"]')) {
    const codes = [...new Set(user.match(/REQ-\d{3}/g) ?? [])]
    return { cases: codes.map((c) => CASES_BY_POINT[c]).filter(Boolean) }
  }
  return quickDrafts
}

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const messages = JSON.parse(raw).messages as { content: string }[]
        const content = JSON.stringify(reply(messages[0].content, messages[1]?.content ?? ''))
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: '```json\n' + content + '\n```' } }],
            usage: { prompt_tokens: 812, completion_tokens: 236, total_tokens: 1048 },
          }),
        )
      })
      return
    }
    res.statusCode = req.url === '/health' ? 200 : 404
    res.end()
  })
  .listen(port, '127.0.0.1', () => console.log(`[mock-llm] http://127.0.0.1:${port}/v1`))
