import path from 'node:path'
import { buildApp } from './app.js'
import { config, demoBaseUrl, modelConfig } from './config.js'
import { openDb } from './db.js'
import { failInterruptedRuns } from './repo/runs.js'
import { Executor } from './runner/executor.js'
import { seedIfEmpty } from './seed.js'

const db = openDb(path.join(config.dataDir, 'platform.db'))
failInterruptedRuns(db)
seedIfEmpty(db)

const artifactsDir = path.join(config.dataDir, 'artifacts')
const executor = new Executor({
  db,
  artifactsDir,
  midsceneDir: config.midsceneDir,
  browserChannel: config.browserChannel,
  headless: config.headless,
  stepTimeoutMs: config.stepTimeoutMs,
  modelConfigured: () => modelConfig().configured,
  aiCache: config.aiCache,
  templateVars: () => ({ DEMO: demoBaseUrl(), DEMO_API: `http://127.0.0.1:${config.port}/demo-api` }),
})

const app = await buildApp({
  db,
  port: config.port,
  artifactsDir,
  midsceneDir: config.midsceneDir,
  executor,
  webDist: process.env.NODE_ENV === 'production' ? path.resolve('dist') : undefined,
})
await app.listen({ port: config.port, host: '127.0.0.1' })
console.log(`[platform] API  http://127.0.0.1:${config.port}/api`)
console.log(`[platform] 演示站点 ${demoBaseUrl()}/index.html`)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close()
    await executor.close()
    process.exit(0)
  })
}
