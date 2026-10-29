import { describe, expect, it, vi } from 'vitest'
import { buildMessages, extractJson, generateDrafts, GenerateError, ModelNotConfiguredError, parseDrafts } from '../../server/ai/generate'

const URL = '{{DEMO}}/index.html'

describe('extractJson', () => {
  it('兼容 ```json 代码块与前后说明文字', () => {
    expect(extractJson('好的，以下是用例：\n```json\n{"cases":[]}\n```\n请查收')).toEqual({ cases: [] })
    expect(extractJson('结果：{"a":1} 完毕')).toEqual({ a: 1 })
  })
  it('没有 JSON 或格式错误时抛出 GenerateError', () => {
    expect(() => extractJson('抱歉，我无法完成')).toThrow(GenerateError)
    expect(() => extractJson('{"cases": [}')).toThrow('JSON 格式不正确')
  })
})

describe('parseDrafts', () => {
  it('规整步骤类型别名，丢弃无效步骤与无效用例', () => {
    const content = JSON.stringify({
      cases: [
        {
          name: ' 登录成功 ',
          description: '主流程',
          steps: [
            { type: 'action', content: '输入 demo 并点击登录' },
            { type: 'AI-Assert', content: '显示欢迎语' },
            { type: 'query', content: 'string[]，待办' },
            { type: 'code', content: 'await page.click()' }, // 生成结果不允许代码步骤
            { type: 'ai_assert', content: '  ' },
          ],
        },
        { name: '', steps: [{ type: 'action', content: 'x' }] },
        { name: '没有步骤', steps: [] },
      ],
    })
    expect(parseDrafts(content, URL)).toEqual([
      {
        name: '登录成功',
        description: '主流程',
        url: URL,
        steps: [
          { type: 'ai_action', content: '输入 demo 并点击登录' },
          { type: 'ai_assert', content: '显示欢迎语' },
          { type: 'ai_query', content: 'string[]，待办' },
        ],
      },
    ])
  })
  it('接受顶层数组', () => {
    expect(parseDrafts('[{"name":"a","steps":[{"type":"ai_action","content":"b"}]}]', URL)).toHaveLength(1)
  })
  it('全部无效时报错', () => {
    expect(() => parseDrafts('{"cases":[{"name":"a","steps":[]}]}', URL)).toThrow('没有生成有效的用例')
  })
})

describe('generateDrafts', () => {
  const cfg = { configured: true, baseUrl: 'https://llm.test/v1', apiKey: 'test-key', model: 'm', timeoutMs: 1000 }
  const reply = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

  it('未配置模型时直接报错，不发请求', async () => {
    const f = reply({})
    await expect(generateDrafts({ ...cfg, configured: false }, '需求', URL, f)).rejects.toThrow(ModelNotConfiguredError)
    expect(f).not.toHaveBeenCalled()
  })

  it('按 OpenAI 兼容格式请求，并返回草稿与 token 用量', async () => {
    const f = reply({
      choices: [{ message: { content: '```json\n{"cases":[{"name":"a","steps":[{"type":"ai_assert","content":"b"}]}]}\n```' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    })
    const r = await generateDrafts(cfg, '登录需求', URL, f)
    expect(r.drafts[0].steps).toEqual([{ type: 'ai_assert', content: 'b' }])
    expect(r.usage.totalTokens).toBe(120)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://llm.test/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    expect(JSON.parse(init.body as string).messages).toEqual(buildMessages('登录需求', URL))
  })

  it('接口报错时带上状态码', async () => {
    await expect(generateDrafts(cfg, '需求', URL, reply('{"error":"invalid key"}', 401))).rejects.toThrow('模型接口返回 401')
  })
})
