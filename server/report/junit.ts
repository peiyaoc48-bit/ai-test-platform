import type { BatchDetail, RunDetail } from '../../shared/types.js'
import { STEP_TYPE_LABEL } from '../../shared/types.js'

// 把一次批量执行导出为 JUnit XML，Jenkins / GitLab / GitHub Actions 都能直接展示。
// 映射：批次 = testsuite，每次运行（一个用例）= testcase；
// 失败 / 异常 → <failure>/<error>，全部跳过 → <skipped>，步骤明细写进 <system-out>。

const esc = (s: string) =>
  s
    // XML 1.0 不允许的控制字符
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const sec = (ms: number) => (ms / 1000).toFixed(3)

function stepLines(run: RunDetail) {
  return run.steps
    .map((s) => `[${s.status}] ${s.index + 1}. ${STEP_TYPE_LABEL[s.type]}（${s.durationMs} ms）${s.content.split('\n')[0]}`)
    .join('\n')
}

export function toJUnit(batch: BatchDetail, runs: RunDetail[], baseUrl = ''): string {
  const failures = runs.filter((r) => r.status === 'failed').length
  const errors = runs.filter((r) => r.status === 'error' || r.status === 'queued' || r.status === 'running').length
  const skipped = runs.filter((r) => r.status === 'skipped').length
  const total = runs.reduce((n, r) => n + r.durationMs, 0)

  const cases = runs.map((r) => {
    const failedStep = r.steps.find((s) => s.status === 'failed')
    let body = ''
    if (r.status === 'failed' && failedStep) {
      const msg = `第 ${failedStep.index + 1} 步失败：${(failedStep.error ?? '').split('\n')[0]}`
      body = `<failure message="${esc(msg)}" type="StepFailed">${esc(failedStep.error ?? '')}</failure>`
    } else if (r.status === 'error' || r.status === 'queued' || r.status === 'running') {
      body = `<error message="${esc(r.error ?? `运行未正常结束（${r.status}）`)}" type="RunError"/>`
    } else if (r.status === 'skipped') {
      body = `<skipped message="全部步骤被跳过（未配置模型）"/>`
    }
    const out = `${stepLines(r)}${baseUrl ? `\n报告：${baseUrl}/runs/${r.id}` : ''}`
    return (
      `    <testcase classname="${esc(batch.name)}" name="${esc(r.caseName)}" time="${sec(r.durationMs)}">` +
      body +
      `<system-out>${esc(out)}</system-out></testcase>`
    )
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="ai-test-platform" tests="${runs.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${sec(total)}">`,
    `  <testsuite name="${esc(batch.name)}" id="${batch.id}" tests="${runs.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${sec(total)}" timestamp="${esc(batch.createdAt)}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n')
}
