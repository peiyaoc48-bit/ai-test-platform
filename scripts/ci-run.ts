// CI 触发脚本：运行一个用例集，轮询到结束，输出汇总并写出 JUnit XML；有失败时以非 0 退出，让流水线变红。
//
//   npx tsx scripts/ci-run.ts --server http://127.0.0.1:3100 --suite 冒烟 --junit reports/junit.xml
//
// --suite 可以是用例集 id 或名称；--env 指定环境（id 或名称，不填用用例集的默认环境）；--timeout 单位秒（默认 600）。
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { BatchDetail, Environment, Suite } from '../shared/types.js'

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: process.env.PLATFORM_URL ?? 'http://127.0.0.1:3100' },
    suite: { type: 'string' },
    junit: { type: 'string' },
    timeout: { type: 'string', default: '600' },
    env: { type: 'string' },
  },
})
if (!values.suite) {
  console.error('用法：npx tsx scripts/ci-run.ts --suite <用例集 id 或名称> [--server URL] [--junit 输出路径] [--timeout 秒]')
  process.exit(2)
}
const server = values.server!.replace(/\/+$/, '')

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${server}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${url} 返回 ${res.status}：${await res.text()}`)
  return (await res.json()) as T
}

const suites = await call<Suite[]>('GET', '/api/suites')
const suite = suites.find((s) => String(s.id) === values.suite || s.name === values.suite)
if (!suite) {
  console.error(`找不到用例集“${values.suite}”。现有：${suites.map((s) => `#${s.id} ${s.name}`).join('，') || '无'}`)
  process.exit(2)
}

let envId: number | undefined
if (values.env) {
  const envs = await call<Environment[]>('GET', '/api/environments')
  const env = envs.find((e) => String(e.id) === values.env || e.name === values.env)
  if (!env) {
    console.error(`找不到环境“${values.env}”。现有：${envs.map((e) => `#${e.id} ${e.name}`).join('，') || '无'}`)
    process.exit(2)
  }
  envId = env.id
}

const { batchId } = await call<{ batchId: number }>('POST', `/api/suites/${suite.id}/run`, { trigger: 'ci', ...(envId ? { envId } : {}) })
console.log(`▶ 运行用例集 #${suite.id}「${suite.name}」，批次 #${batchId}：${server}/batches/${batchId}`)

const deadline = Date.now() + Number(values.timeout) * 1000
let batch: BatchDetail
for (;;) {
  batch = await call<BatchDetail>('GET', `/api/batches/${batchId}`)
  if (batch.status !== 'running') break
  if (Date.now() > deadline) {
    console.error(`✖ 超时：${values.timeout}s 内未完成`)
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 1000))
}

const icon: Record<string, string> = { passed: '✔', failed: '✖', error: '✖', skipped: '○' }
for (const r of batch.runs) {
  console.log(`  ${icon[r.status] ?? '?'} ${r.caseName.padEnd(24)} ${r.status.padEnd(8)} ${(r.durationMs / 1000).toFixed(1)}s  ${server}/runs/${r.id}`)
}
console.log(`\n共 ${batch.total} 个用例：通过 ${batch.passed}，失败 ${batch.failed}，跳过 ${batch.skipped}；耗时 ${(batch.durationMs / 1000).toFixed(1)}s`)

if (values.junit) {
  const xml = await (await fetch(`${server}/api/batches/${batchId}/junit`)).text()
  fs.mkdirSync(path.dirname(path.resolve(values.junit)), { recursive: true })
  fs.writeFileSync(values.junit, xml)
  console.log(`JUnit 报告：${values.junit}`)
}
process.exit(batch.status === 'failed' ? 1 : 0)
