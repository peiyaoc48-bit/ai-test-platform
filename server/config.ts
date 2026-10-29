import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ quiet: true })

const env = process.env
const dataDir = path.resolve(env.DATA_DIR || 'data')
// Midscene 的报告、缓存写到平台数据目录（须在加载 @midscene/web 之前设置）
env.MIDSCENE_RUN_DIR ||= path.join(dataDir, 'midscene')

export const config = {
  port: Number(env.PORT || 3100),
  dataDir,
  midsceneDir: env.MIDSCENE_RUN_DIR,
  browserChannel: env.BROWSER_CHANNEL ?? 'chrome',
  headless: env.HEADLESS !== 'false',
  /** 单个步骤的超时（AI 步骤除外，AI 步骤受模型超时控制） */
  stepTimeoutMs: Number(env.STEP_TIMEOUT_MS || 15_000),
}

/** 每次读取，便于测试中修改环境变量 */
export function modelConfig() {
  const apiKey = env.MIDSCENE_MODEL_API_KEY || ''
  const baseUrl = (env.MIDSCENE_MODEL_BASE_URL || '').replace(/\/+$/, '')
  const visionModel = env.MIDSCENE_MODEL_NAME || ''
  return {
    configured: Boolean(apiKey && baseUrl && visionModel),
    apiKey,
    baseUrl,
    visionModel,
    genModel: env.GEN_MODEL_NAME || visionModel,
    timeoutMs: Number(env.MIDSCENE_MODEL_TIMEOUT || 120_000),
  }
}

export function demoBaseUrl(port = config.port) {
  return `http://127.0.0.1:${port}/demo`
}
