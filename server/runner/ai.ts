import { createHash } from 'node:crypto'
import type { Page } from 'playwright'
import type { Step, StepType } from '../../shared/types.js'
import { formatError } from './steps.js'

/** Midscene Agent 中执行器用到的最小接口，便于单元测试替换 */
export interface AiAgent {
  aiAct(prompt: string): Promise<unknown>
  aiAssert(assertion: string): Promise<unknown>
  aiQuery(demand: string): Promise<unknown>
  readonly metrics: { calls: number; totalTokens: number }
  finalizeReport?(): Promise<string | undefined>
}

/** cacheId：开启 Midscene 缓存（按用例缓存规划结果与元素定位）；不传则不缓存 */
export type AgentFactory = (page: Page, runId: number, opts?: { cacheId?: string }) => Promise<AiAgent>

/** 默认工厂：懒加载 @midscene/web，按运行生成一份回放报告 */
export const midsceneAgentFactory: AgentFactory = async (page, runId, opts = {}) => {
  const { PlaywrightAgent } = await import('@midscene/web/playwright')
  return new PlaywrightAgent(page, {
    generateReport: true,
    autoPrintReportMsg: false,
    reportFileName: `run-${runId}`,
    ...(opts.cacheId ? { cache: { id: opts.cacheId, strategy: 'read-write' as const } } : {}),
  }) as unknown as AiAgent
}

export async function runAiStep(agent: AiAgent, type: StepType, content: string) {
  switch (type) {
    case 'ai_action':
      return agent.aiAct(content)
    case 'ai_assert':
      return agent.aiAssert(content)
    case 'ai_query':
      return agent.aiQuery(content)
    default:
      throw new Error(`不是自然语言步骤：${type}`)
  }
}

/** 读取 Agent 当前累计用量，用于计算单步差值 */
export function usageSnapshot(agent: AiAgent | null) {
  const m = agent?.metrics
  return { calls: m?.calls ?? 0, tokens: m?.totalTokens ?? 0 }
}

/**
 * 用例指纹：由目标地址和步骤内容算出，作为 Midscene 缓存 id 的一部分。
 * 用例改了步骤，指纹随之变化，旧的规划与定位缓存自动失效；内容不变则继续复用缓存。
 */
export function caseFingerprint(url: string, steps: Pick<Step, 'type' | 'content' | 'fallback'>[]) {
  const body = JSON.stringify({ url, steps: steps.map((s) => ({ type: s.type, content: s.content, fallback: s.fallback ?? null })) })
  return createHash('sha256').update(body).digest('hex').slice(0, 8)
}

/**
 * 带诊断的断言：失败后等待一段时间重试一次。
 * - 重试通过：多半是页面尚未稳定（时序问题），步骤算通过，但返回提示，提醒补等待条件；
 * - 仍失败：排除偶发时序问题，再让模型描述页面实际情况，附在错误信息里，方便判断是产品缺陷还是预期写得不清楚。
 */
export async function assertWithDiagnosis(agent: AiAgent, assertion: string, retryDelayMs: number): Promise<{ note: string | null }> {
  try {
    await agent.aiAssert(assertion)
    return { note: null }
  } catch {
    await new Promise((r) => setTimeout(r, retryDelayMs))
  }
  const wait = `${(retryDelayMs / 1000).toFixed(1).replace(/\.0$/, '')} 秒`
  try {
    await agent.aiAssert(assertion)
    return { note: `首次断言失败，等待 ${wait}后重试通过：页面可能尚未稳定（时序问题），建议在断言前先等待目标状态出现。` }
  } catch (e) {
    let actual = ''
    try {
      const q = await agent.aiQuery(`string, 用一句话描述当前页面中与“${assertion}”相关的实际情况`)
      actual = typeof q === 'string' ? q : JSON.stringify(q)
    } catch {
      // 诊断失败不影响断言结论
    }
    throw new Error(
      `${formatError(e)}\n\n诊断：等待 ${wait}后重试仍失败，已排除偶发时序问题。` + (actual ? `\n页面实际情况（AI 描述）：${actual}` : ''),
    )
  }
}
