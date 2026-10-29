// 前后端共用的数据结构

/** 步骤类型：三种自然语言步骤交给 Midscene，code 是 Playwright 代码片段 */
export type StepType = 'ai_action' | 'ai_assert' | 'ai_query' | 'code'

export interface Step {
  type: StepType
  /** 自然语言描述，或 Playwright 代码（可用变量 page、expect、vars） */
  content: string
}

export interface TestCase {
  id: number
  name: string
  description: string
  /** 支持占位符 {{DEMO}}，运行时替换为平台自带演示站点地址 */
  url: string
  steps: Step[]
  createdAt: string
  updatedAt: string
  lastRun?: RunSummary | null
}

export type CaseInput = Pick<TestCase, 'name' | 'description' | 'url' | 'steps'>

/** skipped：所有步骤都被跳过（如全是自然语言步骤但未配置模型） */
export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'skipped'
export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'not_run'

export interface StepResult {
  index: number
  type: StepType
  content: string
  status: StepStatus
  durationMs: number
  error?: string | null
  /** 相对 /artifacts 的截图路径 */
  screenshot?: string | null
  /** ai_query 的返回值 */
  output?: unknown
  aiCalls: number
  tokens: number
}

export interface RunSummary {
  id: number
  caseId: number
  caseName: string
  status: RunStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
  passed: number
  failed: number
  skipped: number
  total: number
  aiCalls: number
  tokens: number
  error?: string | null
}

export interface RunDetail extends RunSummary {
  url: string
  steps: StepResult[]
  /** Midscene 回放报告（仅包含自然语言步骤时生成） */
  midsceneReport?: string | null
}

export interface DailyStat {
  date: string
  runs: number
  passed: number
  /** 通过运行数 / 有结论的运行数（排除全部跳过） */
  passRate: number | null
  avgDurationMs: number
}

export interface Stats {
  totalRuns: number
  passedRuns: number
  failedRuns: number
  passRate: number | null
  avgDurationMs: number
  aiCalls: number
  tokens: number
  daily: DailyStat[]
}

export interface PlatformConfig {
  modelConfigured: boolean
  modelName: string | null
  genModelName: string | null
  demoUrl: string
}

export const STEP_TYPE_LABEL: Record<StepType, string> = {
  ai_action: 'AI 操作',
  ai_assert: 'AI 断言',
  ai_query: 'AI 提取',
  code: 'Playwright 代码',
}
