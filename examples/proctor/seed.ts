// 把“在线考试智能监考系统”（作者的毕业设计）接入平台：创建环境、UI 用例、接口用例和用例集。
// 只通过平台接口写入平台自己的数据，不修改被测系统。重复执行会按名称覆盖。
//
//   npx tsx examples/proctor/seed.ts [--platform http://127.0.0.1:3100] [--web http://localhost:5180] [--api http://localhost:8081]
//
// 被测系统需先启动（见同目录 README.md）。
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { CaseInput, Environment, Suite, TestCase } from '../../shared/types.js'

const { values } = parseArgs({
  options: {
    platform: { type: 'string', default: 'http://127.0.0.1:3100' },
    web: { type: 'string', default: 'http://localhost:5180' },
    api: { type: 'string', default: 'http://localhost:8081' },
    video: {
      type: 'string',
      // 毕设仓库自带的“无人画面”视频，作为模拟摄像头输入
      default: path.join(os.homedir(), 'Desktop/毕设-在线考试智能监考/proctor-web/tests/fixtures/empty.y4m'),
    },
  },
})
const P = values.platform!.replace(/\/+$/, '')

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${P}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} 返回 ${res.status}：${text}`)
  return (text ? JSON.parse(text) : undefined) as T
}

// —— 环境 ——
const envBody = {
  name: '在线监考（本地）',
  description: '毕设：前端 vite + 后端 Spring Boot（H2 内存库）；Chrome 模拟摄像头输入无人画面',
  baseUrl: values.web,
  vars: { API: values.api, TEACHER: 'teacher', TEACHER_PWD: 'teacher123', FAKE_VIDEO: values.video! },
  launchArgs: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--use-file-for-fake-video-capture={{FAKE_VIDEO}}',
  ],
  permissions: ['camera'],
  localStorage: { 'proctor-agreed': '1' },
  stepTimeoutMs: 90000,
}
const envs = await call<Environment[]>('GET', '/api/environments')
const oldEnv = envs.find((e) => e.name === envBody.name)
const env = oldEnv
  ? await call<Environment>('PUT', `/api/environments/${oldEnv.id}`, envBody)
  : await call<Environment>('POST', '/api/environments', envBody)

// —— 用例 ——
const api = (yaml: string) => ({ type: 'api' as const, content: yaml.trim() })
const code = (js: string) => ({ type: 'code' as const, content: js.trim() })
const window = (t: number) =>
  `{ t: ${t}, faceCount: 0, faceAbsentS: ${t}, multiFaceS: 0, partialS: 0, offRatio: 0, offDuration: 0, downRatio: 0, downDuration: 0, meanYawDev: 0, tabHidden: false, focusLost: false, clipboardCount: 0, questionNo: 1 }`

const CASES: CaseInput[] = [
  {
    name: '监考接口：建考 → 开考 → 上报异常 → 交卷 → 复核',
    description: '教师与考生两个角色的完整业务链路；考生账号用 {{$timestamp}} 动态生成，可重复执行。',
    url: '',
    steps: [
      api(`
method: POST
url: "{{API}}/api/user/login"
json: { username: "{{TEACHER}}", password: "{{TEACHER_PWD}}" }
expect:
  status: 200
  json:
    code: 0
    data.role: PROCTOR
extract: { teacherToken: data.token }`),
      api(`
method: POST
url: "{{API}}/api/exam"
headers: { Authorization: "Bearer {{teacherToken}}" }
json: { name: "平台接口测试-{{$timestamp}}", durationMin: 30, sensitivity: MEDIUM, evidenceEnabled: false }
expect:
  status: 200
  json:
    code: 0
    data.sensitivity: MEDIUM
extract: { examId: data.id }`),
      api(`
method: POST
url: "{{API}}/api/user/register"
json: { username: "stu{{$timestamp}}", password: pass1234 }
expect:
  status: 200
  json:
    data.role: CANDIDATE
extract: { studentToken: data.token, studentName: data.username }`),
      api(`
method: POST
url: "{{API}}/api/exam/start"
headers: { Authorization: "Bearer {{studentToken}}" }
json: { examId: "{{examId}}" }
expect:
  status: 200
  json:
    data.sessionId: { type: number }
extract: { sessionId: data.sessionId }`),
      api(`
# 上报一个“人脸连续消失 6 秒”的窗口，应判定为可疑并要求告警
method: POST
url: "{{API}}/api/behavior/report"
headers: { Authorization: "Bearer {{studentToken}}" }
json: { sessionId: "{{sessionId}}", windows: [${window(6)}] }
expect:
  status: 200
  maxMs: 1000
  json:
    data.status: SUSPICIOUS
    data.eventType: FACE_ABSENT
    data.alertRequired: true
    data.riskScore: { gt: 0 }
extract: { eventId: data.eventId }`),
      api(`
method: POST
url: "{{API}}/api/exam/end"
headers: { Authorization: "Bearer {{studentToken}}" }
json: { sessionId: "{{sessionId}}", answers: [] }
expect:
  status: 200
  json:
    data.byType.FACE_ABSENT.count: 1`),
      api(`
method: GET
url: "{{API}}/api/report/{{sessionId}}"
headers: { Authorization: "Bearer {{teacherToken}}" }
expect:
  status: 200
  json:
    data.username: "{{studentName}}"
    data.events: { contains: { type: FACE_ABSENT, reviewStatus: PENDING } }`),
      api(`
method: PUT
url: "{{API}}/api/event/{{eventId}}/review"
headers: { Authorization: "Bearer {{teacherToken}}" }
json: { status: CONFIRMED, note: 平台接口测试复核 }
expect:
  status: 200
  json:
    data.reviewStatus: CONFIRMED`),
    ],
  },
  {
    name: '监考接口：鉴权、越权与参数校验',
    description: '未登录 401、考生越权建考 403、参数不合法 400、错误密码 401。',
    url: '',
    steps: [
      api(`
method: GET
url: "{{API}}/api/exam"
expect: { status: 401, json: { msg: { contains: 未登录 } } }`),
      api(`
method: POST
url: "{{API}}/api/user/register"
json: { username: "stu{{$timestamp}}", password: pass1234 }
expect: { status: 200 }
extract: { studentToken: data.token }`),
      api(`
# 考生不能创建考试
method: POST
url: "{{API}}/api/exam"
headers: { Authorization: "Bearer {{studentToken}}" }
json: { name: 越权考试, durationMin: 30, sensitivity: LOW, evidenceEnabled: false }
expect: { status: 403 }`),
      api(`
method: POST
url: "{{API}}/api/user/login"
json: { username: "{{TEACHER}}", password: "{{TEACHER_PWD}}" }
extract: { teacherToken: data.token }`),
      api(`
# 边界值：时长 0 分钟
method: POST
url: "{{API}}/api/exam"
headers: { Authorization: "Bearer {{teacherToken}}" }
json: { name: 边界, durationMin: 0, sensitivity: LOW, evidenceEnabled: false }
expect: { status: 400, json: { msg: { contains: durationMin } } }`),
      api(`
method: POST
url: "{{API}}/api/user/register"
json: { username: ab, password: pass1234 }
expect: { status: 400, json: { msg: { contains: username } } }`),
      api(`
method: POST
url: "{{API}}/api/user/login"
json: { username: "{{TEACHER}}", password: wrong-password }
expect: { status: 401, json: { msg: 用户名或密码错误 } }`),
    ],
  },
  {
    name: '离线模式：无人画面触发人脸消失并生成报告（选择器 + 视觉断言）',
    description: '摄像头为模拟的无人画面；操作和关键断言用选择器，最后用视觉断言检查报告页（未配置模型时跳过）。',
    url: '{{BASE_URL}}/',
    steps: [
      code(`
await page.click('[data-test=offline]')
// 首次加载人脸检测模型较慢
await expect(page.locator('[data-test=start]')).toBeVisible({ timeout: 60000 })`),
      code(`
await page.selectOption('[data-test=sensitivity]', 'HIGH')
await page.click('[data-test=start]')
await expect(page.locator('[data-test=calib-overlay]')).toContainText('中心')`),
      code(`await expect(page.locator('[data-test=event][data-type=FACE_ABSENT]')).toHaveCount(1, { timeout: 30000 })`),
      { type: 'ai_assert', content: '右侧“异常事件”列表中至少有一条“人脸消失”事件' },
      code(`
await page.evaluate(() => document.dispatchEvent(new ClipboardEvent('copy', { cancelable: true })))
await expect(page.locator('[data-test=event][data-type=COPY_PASTE]')).toHaveCount(1)`),
      code(`
await page.click('[data-test=stop]')
await expect(page.locator('[data-test=report]')).toContainText('人脸消失')
await expect(page.locator('[data-test=report]')).toContainText('复制粘贴')`),
    ],
  },
]

const existing = await call<TestCase[]>('GET', '/api/cases')
const ids: number[] = []
for (const c of CASES) {
  const old = existing.find((e) => e.name === c.name)
  const saved = old ? await call<TestCase>('PUT', `/api/cases/${old.id}`, c) : await call<TestCase>('POST', '/api/cases', c)
  ids.push(saved.id)
}

// —— 用例集 ——
const suiteBody = { name: '在线监考回归', description: '毕设系统：接口链路 + 权限校验 + 离线模式 UI', caseIds: ids, envId: env.id }
const suites = await call<Suite[]>('GET', '/api/suites')
const oldSuite = suites.find((s) => s.name === suiteBody.name)
const suite = oldSuite
  ? await call<Suite>('PUT', `/api/suites/${oldSuite.id}`, suiteBody)
  : await call<Suite>('POST', '/api/suites', suiteBody)

console.log(`环境 #${env.id}「${env.name}」，用例 ${ids.map((i) => `#${i}`).join(' ')}，用例集 #${suite.id}「${suite.name}」`)
console.log(`运行：npm run ci:run -- --server ${P} --suite ${suite.name}`)
