import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { StepStatus } from '../../shared/types.js'
import type { DB } from '../db.js'
import { finishRun, getRun, markRunStarted, updateStep } from '../repo/runs.js'
import { type AgentFactory, type AiAgent, midsceneAgentFactory, runAiStep, usageSnapshot } from './ai.js'
import { ApiStepError, runApiStep } from './api-step.js'
import { deriveRunStatus, formatError, runCodeStep } from './steps.js'

export interface ExecutorOptions {
  db: DB
  artifactsDir: string
  /** Midscene 报告目录，用于把报告绝对路径换成可访问的相对路径 */
  midsceneDir?: string
  browserChannel?: string
  headless?: boolean
  stepTimeoutMs: number
  navTimeoutMs?: number
  /** 是否配置了模型；未配置时自然语言步骤直接跳过 */
  modelConfigured: () => boolean
  agentFactory?: AgentFactory
  /** 模板变量（如 DEMO、DEMO_API），供接口步骤的 {{变量}} 使用 */
  templateVars?: () => Record<string, string>
}

/**
 * 用例执行器：运行排队串行执行（一个浏览器实例，每次运行一个新的 BrowserContext），
 * 每步结束立即写库，前端轮询即可看到实时进度。
 */
export class Executor {
  private queue: number[] = []
  private busy = false
  private browser: Browser | null = null
  private idleWaiters: (() => void)[] = []

  constructor(private opts: ExecutorOptions) {}

  enqueue(runId: number) {
    this.queue.push(runId)
    void this.drain()
  }

  /** 等待队列清空（测试用） */
  idle(): Promise<void> {
    if (!this.busy && !this.queue.length) return Promise.resolve()
    return new Promise((r) => this.idleWaiters.push(r))
  }

  async close() {
    await this.browser?.close().catch(() => {})
    this.browser = null
  }

  private async drain() {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length) {
        const runId = this.queue.shift()!
        await this.execute(runId).catch((e) => {
          finishRun(this.opts.db, runId, { status: 'error', durationMs: 0, error: formatError(e) })
        })
      }
    } finally {
      this.busy = false
      this.idleWaiters.splice(0).forEach((r) => r())
    }
  }

  private async getBrowser() {
    if (!this.browser?.isConnected()) {
      this.browser = await chromium.launch({
        channel: this.opts.browserChannel || undefined,
        headless: this.opts.headless ?? true,
      })
    }
    return this.browser
  }

  private async execute(runId: number) {
    const { db } = this.opts
    const run = getRun(db, runId)
    if (!run) return
    markRunStarted(db, runId)
    const t0 = performance.now()
    const runDir = path.join(this.opts.artifactsDir, `run-${runId}`)
    fs.mkdirSync(runDir, { recursive: true })

    const statuses: StepStatus[] = run.steps.map(() => 'pending')
    let runError: string | null = null
    let agent: AiAgent | null = null
    let midsceneReport: string | null = null
    // 浏览器按需启动：纯接口用例不打开页面
    let context: BrowserContext | null = null
    let page: Page | null = null
    const ensurePage = async () => {
      if (page) return page
      const browser = await this.getBrowser()
      context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page = await context.newPage()
      page.setDefaultTimeout(this.opts.stepTimeoutMs)
      if (run.url) {
        try {
          await page.goto(run.url, { timeout: this.opts.navTimeoutMs ?? 30_000 })
        } catch (e) {
          throw new NavigationError(`打开目标页面失败：${formatError(e)}`)
        }
      }
      return page
    }

    const shoot = async (idx: number) => {
      if (!page) return null
      const file = `step-${idx + 1}.jpg`
      try {
        await page.screenshot({ path: path.join(runDir, file), type: 'jpeg', quality: 70, timeout: 5000 })
        return `run-${runId}/${file}`
      } catch {
        return null
      }
    }

    try {
      // 接口步骤可用 {{DEMO}} / {{DEMO_API}} 以及前面步骤提取的变量
      const vars: Record<string, unknown> = { ...(this.opts.templateVars?.() ?? {}) }
      for (const step of run.steps) {
        const i = step.index
        const isAi = step.type.startsWith('ai_')

        if (isAi && !this.opts.modelConfigured()) {
          statuses[i] = 'skipped'
          updateStep(db, runId, i, { status: 'skipped', error: '跳过（未配置模型）' })
          continue
        }

        updateStep(db, runId, i, { status: 'running' })
        const before = usageSnapshot(agent)
        const s0 = performance.now()
        let status: StepStatus = 'passed'
        let error: string | null = null
        let output: unknown
        try {
          if (step.type === 'api') {
            const r = await runApiStep(step.content, vars, { timeoutMs: this.opts.stepTimeoutMs })
            Object.assign(vars, r.extracted)
            output = r
          } else if (isAi) {
            const p = await ensurePage()
            agent ??= await (this.opts.agentFactory ?? midsceneAgentFactory)(p, runId)
            output = await runAiStep(agent, step.type, step.content)
            if (step.type === 'ai_query') vars[`step${i + 1}`] = output
            else output = undefined
          } else {
            await runCodeStep(step.content, await ensurePage(), vars, this.opts.stepTimeoutMs * 2)
          }
        } catch (e) {
          if (e instanceof NavigationError) {
            runError = e.message
            break
          }
          status = 'failed'
          error = formatError(e)
          if (e instanceof ApiStepError) output = e.result
        }
        const durationMs = performance.now() - s0
        const after = usageSnapshot(agent)
        statuses[i] = status
        updateStep(db, runId, i, {
          status,
          error,
          output,
          durationMs,
          screenshot: step.type === 'api' ? null : await shoot(i),
          aiCalls: after.calls - before.calls,
          tokens: after.tokens - before.tokens,
        })
        if (status === 'failed') break
      }
    } finally {
      // 失败后的步骤标记为未执行
      statuses.forEach((s, i) => {
        if (s === 'pending') {
          statuses[i] = 'not_run'
          updateStep(db, runId, i, { status: 'not_run' })
        }
      })
      if (agent?.finalizeReport) {
        const file = await agent.finalizeReport().catch(() => undefined)
        if (file && this.opts.midsceneDir && file.startsWith(this.opts.midsceneDir)) {
          midsceneReport = path.relative(this.opts.midsceneDir, file)
        }
      }
      await (context as BrowserContext | null)?.close().catch(() => {})
    }

    finishRun(db, runId, {
      status: runError ? 'error' : deriveRunStatus(statuses),
      durationMs: performance.now() - t0,
      error: runError,
      midsceneReport,
    })
  }
}

class NavigationError extends Error {}
