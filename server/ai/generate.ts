import type { CaseInput, Step, StepType } from '../../shared/types.js'

export interface ChatConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class ModelNotConfiguredError extends Error {
  statusCode = 400
  code = 'MODEL_NOT_CONFIGURED'
  constructor() {
    super('未配置大模型：请在 .env 中填写 MIDSCENE_MODEL_BASE_URL / MIDSCENE_MODEL_API_KEY / MIDSCENE_MODEL_NAME 后重启平台')
  }
}

export class GenerateError extends Error {
  statusCode = 502
  code = 'GENERATE_FAILED'
}

const SYSTEM_PROMPT = `你是资深测试开发工程师，负责把产品需求转换成 UI 自动化测试用例草稿。
用例会由视觉模型（Midscene.js）看页面截图执行，所以步骤必须用中文自然语言描述“看得见的界面元素”。

步骤类型只有三种：
- ai_action：一次界面操作，如“在用户名输入框输入 demo，然后点击登录按钮”（可把同一表单的连续操作写在一步里）
- ai_assert：一条可以从截图直接判断真假的断言，如“页面顶部显示‘欢迎你，demo’”
- ai_query：从页面提取数据，以返回类型开头，如“string[]，列表中所有待办事项的文字”

要求：
1. 每条用例从目标 URL 打开的页面开始，相互独立，不依赖其他用例的执行结果。
2. 覆盖主流程，并补充关键的异常/边界场景（如错误输入、空输入）；一般 2～5 条用例。
3. 每条用例 2～8 步，至少包含一个 ai_assert；断言要具体（写出期望出现的文字），不要写“操作成功”这类含糊描述。
4. 需求里没有给出的账号、文案不要编造；如必须使用，在用例 description 中注明“需确认”。

只输出 JSON，不要输出其他文字，格式：
{"cases":[{"name":"用例名称","description":"覆盖的场景与前置条件","steps":[{"type":"ai_action","content":"..."}]}]}`

export function buildMessages(requirement: string, url: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `目标 URL：${url}\n\n需求描述：\n${requirement.trim()}` },
  ]
}

/** 调用 OpenAI 兼容的 /chat/completions 接口 */
export async function chatCompletion(cfg: ChatConfig, messages: ChatMessage[], fetchImpl: typeof fetch = fetch) {
  let res: Response
  try {
    res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    })
  } catch (e: any) {
    throw new GenerateError(e?.name === 'TimeoutError' ? `模型调用超时（${cfg.timeoutMs} ms）` : `模型调用失败：${e?.message ?? e}`)
  }
  const text = await res.text()
  if (!res.ok) throw new GenerateError(`模型接口返回 ${res.status}：${text.slice(0, 300)}`)
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new GenerateError('模型接口返回的不是 JSON')
  }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new GenerateError('模型返回内容为空')
  return {
    content,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
  }
}

const TYPE_ALIASES: Record<string, StepType> = {
  ai_action: 'ai_action',
  action: 'ai_action',
  aiaction: 'ai_action',
  aiact: 'ai_action',
  ai_assert: 'ai_assert',
  assert: 'ai_assert',
  aiassert: 'ai_assert',
  ai_query: 'ai_query',
  query: 'ai_query',
  aiquery: 'ai_query',
}

/** 从模型输出中取出 JSON：兼容 ```json 代码块、前后多余文字 */
export function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : content
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new GenerateError('模型输出中没有找到 JSON')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new GenerateError('模型输出的 JSON 格式不正确')
  }
}

/** 把模型输出规整为用例草稿；不合规的步骤/用例被丢弃，全部不合规时报错 */
export function parseDrafts(content: string, url: string): CaseInput[] {
  const json = extractJson(content) as any
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.cases) ? json.cases : []
  const drafts: CaseInput[] = []
  for (const c of list) {
    if (!c || typeof c !== 'object') continue
    const steps: Step[] = (Array.isArray(c.steps) ? c.steps : [])
      .map((s: any): Step | null => {
        const type = TYPE_ALIASES[String(s?.type ?? '').toLowerCase().replace(/[\s-]/g, '')]
        const content = typeof s?.content === 'string' ? s.content.trim() : ''
        return type && content ? { type, content } : null
      })
      .filter(Boolean)
      .slice(0, 50)
    const name = typeof c.name === 'string' ? c.name.trim().slice(0, 100) : ''
    if (!name || !steps.length) continue
    drafts.push({ name, description: typeof c.description === 'string' ? c.description.trim() : '', url, steps })
  }
  if (!drafts.length) throw new GenerateError('模型没有生成有效的用例，请补充需求细节后重试')
  return drafts
}

export async function generateDrafts(
  cfg: ChatConfig & { configured: boolean },
  requirement: string,
  url: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!cfg.configured) throw new ModelNotConfiguredError()
  const { content, usage } = await chatCompletion(cfg, buildMessages(requirement, url), fetchImpl)
  return { drafts: parseDrafts(content, url), usage, model: cfg.model }
}
