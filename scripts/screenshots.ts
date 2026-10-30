// 生成 README 截图：npx tsx scripts/screenshots.ts <平台地址> [假模型实例地址]
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const mockBase = process.argv[3]
const out = 'docs/screenshots'

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
const shot = async (name: string, fullPage = false) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage })
}

await page.goto(`${base}/cases`)
await shot('cases')
await page.goto(`${base}/cases/2/edit`)
await shot('case-edit')

const runs = await (await page.request.get(`${base}/api/runs?limit=200`)).json()
const failed = runs.find((r: any) => r.status === 'failed')
const passed = runs.find((r: any) => r.status === 'passed' && r.skipped > 0) ?? runs.find((r: any) => r.status === 'passed')
if (failed) {
  await page.goto(`${base}/runs/${failed.id}`)
  await shot('run-failed', true)
}
if (passed) {
  await page.goto(`${base}/runs/${passed.id}`)
  await shot('run-passed', true)
}
const apiRun = runs.find((r: any) => r.caseName.includes('（接口）') && r.status === 'passed')
if (apiRun) {
  await page.goto(`${base}/runs/${apiRun.id}`)
  await page.locator('[data-test=api-exchange] summary').first().click()
  await shot('run-api')
}
const batches = await (await page.request.get(`${base}/api/batches`)).json()
const normal = batches.find((b: any) => b.kind === 'normal')
if (normal) {
  await page.goto(`${base}/batches/${normal.id}`)
  await shot('batch')
}
const robust = batches.find((b: any) => b.kind === 'robustness' && b.status !== 'running')
if (robust) {
  await page.goto(`${base}/batches/${robust.id}`)
  await shot('robustness')
}
await page.goto(`${base}/environments`)
await shot('environments')
const envs = await (await page.request.get(`${base}/api/environments`)).json()
if (envs[0]) {
  await page.goto(`${base}/environments/${envs[0].id}/edit`)
  await shot('environment-edit', true)
}
await page.goto(`${base}/suites`)
await shot('suites')
await page.goto(`${base}/reports`)
await page.hover('svg path.col >> nth=5').catch(() => {})
await shot('reports')
await page.goto(`${base}/generate`)
await page.click('[data-test=fill-example]')
await shot('generate-no-model')

if (mockBase) {
  await page.goto(`${mockBase}/generate`)
  await page.click('[data-test=fill-example]')
  await page.click('[data-test=generate]')
  await page.waitForSelector('[data-test=draft]')
  await shot('generate-drafts', true)
}
await browser.close()
console.log('done')
