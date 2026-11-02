import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Priority, PromptInfo, ReqPoint, Step } from '../../shared/types.js'
import { type ChatConfig, type ChatMessage, chatCompletion, extractJson, GenerateError, ModelNotConfiguredError, normalizeStepType } from './generate.js'

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts')

// —— Prompt 版本：prompts/<kind>-<version>.md，第一行“# 说明”，其余为系统提示词 ——
// 改 Prompt 必须新建版本文件，不能原地修改，否则历史批次的度量不可比

export function listPrompts(dir = PROMPT_DIR): PromptInfo[] {
  return fs
    .readdirSync(dir)
    .map((f) => f.match(/^(parse|gen)-(v\d+)\.md$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ kind: m[1] as PromptInfo['kind'], version: m[2], summary: readPrompt(m[1] as PromptInfo['kind'], m[2], dir).summary }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || Number(a.version.slice(1)) - Number(b.version.slice(1)))
}

const badPrompt = (msg: string) => Object.assign(new Error(msg), { statusCode: 400 })

export function readPrompt(kind: PromptInfo['kind'], version: string, dir = PROMPT_DIR) {
  // 版本号来自请求参数：只接受 vN，防止拼出目录外的路径；参数错误是 400，不是模型调用失败（502）
  if (!/^v\d+$/.test(version)) throw badPrompt(`Prompt 版本不合法：${version}`)
  const file = path.join(dir, `${kind}-${version}.md`)
  if (!fs.existsSync(file)) throw badPrompt(`Prompt 版本不存在：${kind}-${version}`)
  const text = fs.readFileSync(file, 'utf8')
  const [first, ...rest] = text.split('\n')
  return { summary: first.replace(/^#\s*/, '').trim(), system: rest.join('\n').trim() }
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** 用于比对摘录：去掉空白与常见标点，全角转半角 */
export function normalizeText(s: string) {
  return s
    .normalize('NFKC')
    .replace(/[\s，。、；：！？,.;:!?“”"'‘’「」『』()（）【】\[\]<>《》\-—…·*#>`]/g, '')
    .toLowerCase()
}

export function excerptFound(content: string, excerpt: string) {
  const e = normalizeText(excerpt)
  return e.length > 0 && normalizeText(content).includes(e)
}

/** 字符二元组 Dice 系数，用于重新解析时匹配旧需求点 */
export function similarity(a: string, b: string) {
  const grams = (s: string) => {
    const n = normalizeText(s)
    const m = new Map<string, number>()
    for (let i = 0; i < n.length - 1; i++) m.set(n.slice(i, i + 2), (m.get(n.slice(i, i + 2)) ?? 0) + 1)
    return { m, size: Math.max(n.length - 1, 0) }
  }
  const x = grams(a)
  const y = grams(b)
  if (!x.size || !y.size) return normalizeText(a) === normalizeText(b) ? 1 : 0
  let common = 0
  for (const [g, c] of x.m) common += Math.min(c, y.m.get(g) ?? 0)
  return (2 * common) / (x.size + y.size)
}

// —— 解析：需求文档 → 需求点 ——

export interface ParsedPoint {
  title: string
  detail: string
  priority: Priority
  sourceExcerpt: string
}

export function buildParseMessages(system: string, name: string, content: string): ChatMessage[] {
  return [
    { role: 'system', content: system },
    { role: 'user', content: `需求文档：《${name}》\n\n${content.trim()}` },
  ]
}

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2']

/** 规整模型输出的需求点：缺标题的丢弃，优先级不认识的按 P1，标题重复的去重 */
export function parsePoints(output: string): ParsedPoint[] {
  const json = extractJson(output) as any
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.points) ? json.points : []
  const seen = new Set<string>()
  const points: ParsedPoint[] = []
  for (const p of list) {
    const title = typeof p?.title === 'string' ? p.title.trim().slice(0, 200) : ''
    if (!title || seen.has(normalizeText(title))) continue
    seen.add(normalizeText(title))
    const pr = String(p.priority ?? '').toUpperCase()
    points.push({
      title,
      detail: typeof p.detail === 'string' ? p.detail.trim().slice(0, 1000) : '',
      priority: PRIORITIES.includes(pr as Priority) ? (pr as Priority) : 'P1',
      sourceExcerpt: typeof p.excerpt === 'string' ? p.excerpt.trim().slice(0, 500) : '',
    })
  }
  if (!points.length) throw new GenerateError('模型没有解析出有效的需求点，请检查需求文档内容')
  return points.slice(0, 200)
}

/**
 * 重新解析时，把新需求点和已有的 active 需求点按标题相似度一一匹配（贪心，从最相似的开始）。
 * 匹配上的沿用旧编号与用例关联；返回 新点下标 → 旧点 id。
 */
export function matchPoints(fresh: { title: string }[], existing: { id: number; title: string }[], threshold = 0.6) {
  const pairs: { i: number; id: number; s: number }[] = []
  fresh.forEach((f, i) => existing.forEach((e) => {
    const s = similarity(f.title, e.title)
    if (s >= threshold) pairs.push({ i, id: e.id, s })
  }))
  pairs.sort((a, b) => b.s - a.s)
  const result = new Map<number, number>()
  const used = new Set<number>()
  for (const p of pairs) {
    if (result.has(p.i) || used.has(p.id)) continue
    result.set(p.i, p.id)
    used.add(p.id)
  }
  return result
}

// —— 生成：需求点 → 用例草稿 ——

export interface GeneratedDraft {
  name: string
  description: string
  url: string
  steps: Step[]
  pointIds: number[]
  confidence: number | null
}

export function buildGenMessages(
  system: string,
  opts: { url: string; points: Pick<ReqPoint, 'code' | 'title' | 'detail' | 'priority'>[]; existingCases: string[] },
): ChatMessage[] {
  const pts = opts.points.map((p) => `- ${p.code}【${p.priority}】${p.title}${p.detail ? `（${p.detail}）` : ''}`).join('\n')
  const existing = opts.existingCases.length ? opts.existingCases.map((n) => `- ${n}`).join('\n') : '（无）'
  return [
    { role: 'system', content: system },
    { role: 'user', content: `目标 URL：${opts.url}\n\n需求点：\n${pts}\n\n已有用例（不要重复）：\n${existing}` },
  ]
}

/** 生成批次的输入指纹：Prompt 版本 + 需求点内容；相同则两个批次的输入可比 */
export function genInputHash(promptVersion: string, url: string, points: Pick<ReqPoint, 'code' | 'title' | 'detail' | 'priority'>[]) {
  return sha256(JSON.stringify([promptVersion, url, points.map((p) => [p.code, p.title, p.detail, p.priority])]))
}

/** 规整生成结果：只保留自然语言步骤；points 中不在本批范围内的编号丢弃，一个都对不上的用例也丢弃 */
export function parseGenDrafts(output: string, url: string, codeToId: Map<string, number>): GeneratedDraft[] {
  const json = extractJson(output) as any
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.cases) ? json.cases : []
  const drafts: GeneratedDraft[] = []
  for (const c of list) {
    if (!c || typeof c !== 'object') continue
    const name = typeof c.name === 'string' ? c.name.trim().slice(0, 100) : ''
    const steps: Step[] = (Array.isArray(c.steps) ? c.steps : [])
      .map((s: any): Step | null => {
        const type = normalizeStepType(s?.type)
        const content = typeof s?.content === 'string' ? s.content.trim() : ''
        return type && content ? { type, content } : null
      })
      .filter(Boolean)
      .slice(0, 50)
    const codes: unknown[] = Array.isArray(c.points) ? c.points : []
    const pointIds = [...new Set(codes.map((x) => codeToId.get(String(x).trim().toUpperCase())).filter((x): x is number => x !== undefined))]
    if (!name || !steps.length || !pointIds.length) continue
    const conf = Number(c.confidence)
    drafts.push({
      name,
      description: typeof c.description === 'string' ? c.description.trim() : '',
      url,
      steps,
      pointIds,
      confidence: Number.isFinite(conf) && c.confidence !== null && c.confidence !== '' ? Math.min(1, Math.max(0, conf)) : null,
    })
  }
  if (!drafts.length) throw new GenerateError('模型没有生成有效的用例（每条用例需要有步骤，并标注覆盖本批范围内的需求点）')
  return drafts
}

/** 调用模型并计时；未配置模型时直接报错 */
export async function callModel(cfg: ChatConfig & { configured: boolean }, messages: ChatMessage[], fetchImpl: typeof fetch = fetch) {
  if (!cfg.configured) throw new ModelNotConfiguredError()
  const started = Date.now()
  const { content, usage } = await chatCompletion(cfg, messages, fetchImpl)
  return { content, tokens: usage.totalTokens, durationMs: Date.now() - started }
}
