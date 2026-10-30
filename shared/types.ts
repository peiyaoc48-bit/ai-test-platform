// 前后端共用的数据结构

/** 步骤类型：三种自然语言步骤交给 Midscene，code 是 Playwright 代码片段，api 是 YAML 描述的 HTTP 请求 */
export type StepType = 'ai_action' | 'ai_assert' | 'ai_query' | 'code' | 'api'

export interface Step {
  type: StepType
  /** 自然语言描述、Playwright 代码（可用变量 page、expect、vars）或接口定义（YAML） */
  content: string
  /** 仅代码步骤：选择器失效导致失败时，改用视觉模型按这段描述执行（自愈） */
  fallback?: StepFallback | null
}

export interface StepFallback {
  type: 'ai_action' | 'ai_assert'
  content: string
}

export interface TestCase {
  id: number
  name: string
  description: string
  /** 支持占位符 {{DEMO}}，运行时替换为平台自带演示站点地址；纯接口用例可为空 */
  url: string
  steps: Step[]
  createdAt: string
  updatedAt: string
  lastRun?: RunSummary | null
}

export type CaseInput = Pick<TestCase, 'name' | 'description' | 'url' | 'steps'>

/** skipped：所有步骤都被跳过（如全是自然语言步骤但未配置模型） */
export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'skipped'
/** healed：代码步骤失败后由 AI 兜底通过 */
export type StepStatus = 'pending' | 'running' | 'passed' | 'healed' | 'failed' | 'skipped' | 'not_run'

export interface StepResult {
  index: number
  type: StepType
  content: string
  fallback?: StepFallback | null
  status: StepStatus
  durationMs: number
  error?: string | null
  /** 相对 /artifacts 的截图路径 */
  screenshot?: string | null
  /** ai_query 的返回值，或接口步骤的请求 / 响应摘要 */
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
  /** 由 AI 兜底通过的步骤数（不计入 passed） */
  healed: number
  failed: number
  skipped: number
  total: number
  aiCalls: number
  tokens: number
  error?: string | null
  batchId?: number | null
  envName?: string | null
  /** 变更注入：none / attr（去掉测试标记）/ style（更换视觉样式） */
  mutation?: Mutation
}

export type Mutation = 'none' | 'attr' | 'style'
export const MUTATION_LABEL: Record<Mutation, string> = { none: '无变更', attr: '去掉测试标记', style: '更换视觉样式' }

export interface RunDetail extends RunSummary {
  url: string
  steps: StepResult[]
  /** Midscene 回放报告（仅包含自然语言步骤时生成） */
  midsceneReport?: string | null
  /** 运行时的环境快照 */
  env?: EnvSnapshot | null
  continueOnFailure?: boolean
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

/** 运行环境：被测地址、变量与浏览器配置。运行时保存一份快照，历史报告不受后续修改影响 */
export interface Environment {
  id: number
  name: string
  description: string
  /** 用例 URL 和接口步骤中可用 {{BASE_URL}} 引用 */
  baseUrl: string
  /** 自定义变量，可在 URL、接口步骤中用 {{名称}} 引用，代码步骤中用 vars.名称 读取 */
  vars: Record<string, string>
  /** Chromium 启动参数，如 --use-fake-device-for-media-stream */
  launchArgs: string[]
  /** 授予页面的权限，如 camera、microphone */
  permissions: string[]
  /** 页面脚本执行前预置的 localStorage（如“已同意协议”标记） */
  localStorage: Record<string, string>
  /** 单步超时（毫秒），不填用平台默认值 */
  stepTimeoutMs: number | null
  createdAt: string
  updatedAt: string
}

export type EnvironmentInput = Omit<Environment, 'id' | 'createdAt' | 'updatedAt'>
export type EnvSnapshot = Omit<Environment, 'createdAt' | 'updatedAt'>

export interface Suite {
  id: number
  name: string
  description: string
  caseIds: number[]
  /** 运行用例集时默认使用的环境 */
  envId: number | null
  createdAt: string
  updatedAt: string
  lastBatch?: BatchSummary | null
}

export type SuiteInput = Pick<Suite, 'name' | 'description' | 'caseIds' | 'envId'>

export interface BatchSummary {
  id: number
  suiteId: number | null
  name: string
  trigger: 'manual' | 'ci'
  /** normal：普通批量运行；robustness：同一用例在不同变更下的对比 */
  kind: 'normal' | 'robustness'
  createdAt: string
  /** 由所含运行推导：有未结束的为 running，有失败 / 异常为 failed，全部跳过为 skipped */
  status: RunStatus
  total: number
  passed: number
  failed: number
  skipped: number
  /** 从第一条运行开始到最后一条结束的墙钟时间 */
  durationMs: number
}

export interface BatchDetail extends BatchSummary {
  runs: RunSummary[]
}

export interface FlakyCase {
  caseId: number
  caseName: string
  /** 最近若干次运行中“通过 ↔ 失败”的切换次数 */
  transitions: number
  passRate: number
  /** 从旧到新的运行结果 */
  recent: RunStatus[]
}

export interface DashboardData {
  counts: { cases: number; suites: number; environments: number; aiSteps: number; apiSteps: number; codeSteps: number }
  /** 近 7 天 */
  week: Stats
  /** 上一个 7 天的运行通过率，用于环比 */
  prevPassRate: number | null
  daily: DailyStat[]
  /** 最近一次运行失败的用例 */
  failing: RunSummary[]
  flaky: FlakyCase[]
  recent: RunSummary[]
  flakyRule: { window: number; minTransitions: number }
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
  api: '接口请求',
}
