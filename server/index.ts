import path from 'node:path'
import { buildApp } from './app.js'
import { config, demoBaseUrl } from './config.js'
import { openDb } from './db.js'
import { failInterruptedRuns } from './repo/runs.js'
import { seedIfEmpty } from './seed.js'

const db = openDb(path.join(config.dataDir, 'platform.db'))
failInterruptedRuns(db)
seedIfEmpty(db)

const app = await buildApp({
  db,
  port: config.port,
  artifactsDir: path.join(config.dataDir, 'artifacts'),
  webDist: process.env.NODE_ENV === 'production' ? path.resolve('dist') : undefined,
})
await app.listen({ port: config.port, host: '127.0.0.1' })
console.log(`[platform] API  http://127.0.0.1:${config.port}/api`)
console.log(`[platform] 演示站点 ${demoBaseUrl()}/index.html`)
