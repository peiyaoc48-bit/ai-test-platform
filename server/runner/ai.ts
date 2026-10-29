import type { Page } from 'playwright'
import type { StepType } from '../../shared/types.js'

/** Midscene Agent 中执行器用到的最小接口，便于单元测试替换 */
export interface AiAgent {
  aiAct(prompt: string): Promise<unknown>
  aiAssert(assertion: string): Promise<unknown>
  aiQuery(demand: string): Promise<unknown>
  readonly metrics: { calls: number; totalTokens: number }
  finalizeReport?(): Promise<string | undefined>
}

export type AgentFactory = (page: Page, runId: number) => Promise<AiAgent>

/** 默认工厂：懒加载 @midscene/web，按运行生成一份回放报告 */
export const midsceneAgentFactory: AgentFactory = async (page, runId) => {
  const { PlaywrightAgent } = await import('@midscene/web/playwright')
  return new PlaywrightAgent(page, {
    generateReport: true,
    autoPrintReportMsg: false,
    reportFileName: `run-${runId}`,
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
