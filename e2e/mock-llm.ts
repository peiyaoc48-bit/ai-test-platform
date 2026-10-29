// E2E 用的假大模型：实现 OpenAI 兼容的 /v1/chat/completions，固定返回两条用例草稿。
// 只用于平台自身的端到端测试，不代表真实模型的生成效果。
import http from 'node:http'

const port = Number(process.env.MOCK_LLM_PORT || 3297)

const drafts = {
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

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      req.resume()
      req.on('end', () => {
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: '```json\n' + JSON.stringify(drafts) + '\n```' } }],
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
