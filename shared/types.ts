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

/** admin：可编辑；viewer：公开演示的只读访客；anonymous：需登录 */
export type Role = 'admin' | 'viewer' | 'anonymous'

export interface SessionInfo {
  role: Role
  authRequired: boolean
  publicDemo: boolean
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

// —— 用例工坊：需求 → 需求点 → 生成批次 → 草稿审核 → 入库；需求覆盖矩阵 ——

export type Priority = 'P0' | 'P1' | 'P2'

export interface Requirement {
  id: number
  name: string
  /** 每次修改原文版本号 +1 */
  version: number
  content: string
  contentHash: string
  /** 生成用例时的默认 URL */
  targetUrl: string
  createdAt: string
  updatedAt: string
}

export interface RequirementSummary extends Requirement {
  points: number
  batches: number
  pendingDrafts: number
  /** 已验证（关联用例最近一次运行通过）的需求点占比；没有需求点时为 null */
  verifiedRate: number | null
  /** 已关联用例的需求点占比 */
  linkedRate: number | null
}

export interface ReqPoint {
  id: number
  requirementId: number
  /** 为空表示人工新增 */
  parseId: number | null
  code: string
  title: string
  detail: string
  priority: Priority
  /** 原文摘录（出处） */
  sourceExcerpt: string
  /** 摘录能否在原文中找到；找不到说明模型可能编造了需求 */
  excerptFound: boolean
  status: 'active' | 'removed'
}

export type ReqPointInput = Pick<ReqPoint, 'title' | 'detail' | 'priority' | 'sourceExcerpt'> & { id?: number }

export interface ParseRecord {
  id: number
  requirementId: number
  requirementVersion: number
  model: string
  promptVersion: string
  tokens: number
  durationMs: number
  /** 本次解析新增 / 沿用 / 移除的需求点数 */
  added: number
  kept: number
  removed: number
  createdAt: string
}

export type Verdict = 'pending' | 'accepted' | 'edited' | 'discarded'
export type DiscardReason = 'duplicate' | 'out_of_scope' | 'not_executable' | 'vague_assert' | 'low_value' | 'other'

export const VERDICT_LABEL: Record<Verdict, string> = { pending: '待审核', accepted: '通过', edited: '修改后通过', discarded: '废弃' }
export const DISCARD_REASON_LABEL: Record<DiscardReason, string> = {
  duplicate: '重复',
  out_of_scope: '需求外（幻觉）',
  not_executable: '不可执行',
  vague_assert: '断言含糊',
  low_value: '价值低',
  other: '其他',
}

/** 审核时的修改量：按步骤（类型 + 内容）对齐后统计 */
export interface EditStats {
  added: number
  removed: number
  changed: number
  kept: number
  nameChanged: boolean
}

export interface Draft {
  id: number
  batchId: number
  /** 原稿，生成后不再修改 */
  name: string
  description: string
  url: string
  steps: Step[]
  /** 模型声称覆盖的需求点 */
  pointIds: number[]
  confidence: number | null
  verdict: Verdict
  discardReason: DiscardReason | null
  /** 入库的终稿（通过时与原稿相同） */
  final: (CaseInput & { pointIds: number[] }) | null
  editStats: EditStats | null
  note: string
  reviewedAt: string | null
  caseId: number | null
}

/** 比例与 95% Wilson 置信区间；分母为 0 时 rate 为 null */
export interface Proportion {
  n: number
  k: number
  rate: number | null
  ci: [number, number] | null
}

export interface BatchStats {
  total: number
  reviewed: number
  accepted: number
  edited: number
  discarded: number
  /** (通过 + 修改后通过) / 已审核 */
  adoption: Proportion
  /** 通过 / 已审核 */
  direct: Proportion
  /** 修改后通过的草稿平均改动步数（增 + 删 + 改） */
  avgEditedSteps: number | null
  reasons: Record<DiscardReason, number>
  /** 本批入库用例的首次运行（无变更注入、排除跳过）通过情况 */
  firstRun: Proportion
  /** 本批让多少个需求点从“未关联”变为“已关联” */
  newlyLinked: number
  /** 每条被采纳用例平均消耗的生成 token */
  tokensPerAdopted: number | null
}

export interface GenBatch {
  id: number
  /** 同一需求内的序号，界面上显示为 batch-1、batch-2 */
  seq: number
  requirementId: number
  parseId: number | null
  scope: number[]
  model: string
  promptVersion: string
  inputHash: string
  tokens: number
  durationMs: number
  createdAt: string
  stats: BatchStats
}

export interface GenBatchDetail extends GenBatch {
  drafts: Draft[]
  points: ReqPoint[]
}

export interface RequirementDetail extends Requirement {
  points: ReqPoint[]
  parses: ParseRecord[]
  batches: GenBatch[]
}

/** uncovered：无关联用例；linked：已关联但没有可下结论的运行；verified：至少一条关联用例最近一次运行通过；failed：关联用例最近一次运行都失败 */
export type CoverageStatus = 'uncovered' | 'linked' | 'verified' | 'failed'
export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  uncovered: '未覆盖',
  linked: '已关联·未执行',
  verified: '已验证',
  failed: '失败',
}

export interface CoverageRow {
  point: ReqPoint
  status: CoverageStatus
  cases: { id: number; name: string; lastStatus: RunStatus | null; lastRunId: number | null }[]
}

export interface Coverage {
  requirementId: number
  total: number
  counts: Record<CoverageStatus, number>
  /** 优先级为 P0 且未覆盖的需求点 */
  p0Uncovered: ReqPoint[]
  rows: CoverageRow[]
  /** 按批次累计：截至该批次，由生成用例关联到的需求点数 */
  timeline: { batchId: number; seq: number; promptVersion: string; linked: number; rate: number }[]
}

export interface PromptInfo {
  kind: 'parse' | 'gen'
  version: string
  /** Prompt 文件第一行的说明 */
  summary: string
}

/** 两个批次的对比：采纳率差异用 Fisher 精确检验 */
export interface BatchCompare {
  a: GenBatch
  b: GenBatch
  /** 两批是否针对相同的需求点（输入可比） */
  sameScope: boolean
  adoptionPValue: number | null
  /** 每组已审核数都 ≥ 20 时才认为样本量足够 */
  enoughSamples: boolean
}
