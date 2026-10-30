import { expect, test, type Page } from '@playwright/test'

// 平台自身 E2E（未配置模型）：用平台的页面去测“平台测演示站点”这条链路

async function createCase(page: Page, name: string, steps: { type?: string; content: string }[]) {
  await page.goto('/cases')
  await page.getByTestId('new-case').click()
  await page.getByTestId('case-name-input').fill(name)
  // 默认带一个自然语言空步骤，先删掉
  await page.getByTestId('step-remove').first().click()
  for (const s of steps) {
    await page.getByTestId('add-code-step').click()
    const row = page.getByTestId('step-row').last()
    if (s.type) await row.getByTestId('step-type').selectOption(s.type)
    await row.getByTestId('step-content').fill(s.content)
  }
  await page.getByTestId('save-case').click()
  await expect(page).toHaveURL(/\/cases$/)
}

const row = (page: Page, name: string) => page.getByTestId('case-row').filter({ hasText: name })

test('首页展示示例用例与“未配置模型”状态', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/cases$/)
  await expect(page.getByTestId('case-row')).toHaveCount(4)
  await expect(page.getByTestId('model-status')).toContainText('未配置模型')
})

test('新建用例 → 执行 → 查看报告', async ({ page }) => {
  await createCase(page, 'E2E 登录并添加待办', [
    { content: `await page.fill('[data-test=username]', 'demo')\nawait page.fill('[data-test=password]', 'demo123')\nawait page.click('[data-test=submit]')` },
    { content: `await expect(page.locator('[data-test=welcome]')).toContainText('demo')` },
    { content: `await page.fill('[data-test=new-todo]', 'E2E 待办')\nawait page.click('[data-test=add]')\nawait expect(page.getByText('E2E 待办')).toBeVisible()` },
  ])
  await row(page, 'E2E 登录并添加待办').getByTestId('run').click()

  await expect(page).toHaveURL(/\/runs\/\d+$/)
  await expect(page.getByTestId('run-status')).toHaveText('通过', { timeout: 30_000 })
  await expect(page.getByTestId('step-status')).toHaveText(['通过', '通过', '通过'])
  await expect(page.getByTestId('pass-rate')).toHaveText('100%')

  await page.getByRole('link', { name: '测试报告' }).click()
  await expect(page.getByTestId('run-row').first()).toContainText('E2E 登录并添加待办')
  await expect(page.getByTestId('run-row').first()).toContainText('通过')
})

test('失败步骤展示错误信息和截图，后续步骤不执行', async ({ page }) => {
  await createCase(page, 'E2E 故意失败', [
    { content: `await expect(page.locator('h1')).toHaveText('注册', { timeout: 1000 })` },
    { content: `await page.click('[data-test=submit]')` },
  ])
  await row(page, 'E2E 故意失败').getByTestId('run').click()
  await expect(page.getByTestId('run-status')).toHaveText('失败', { timeout: 30_000 })
  await expect(page.getByTestId('step-status')).toHaveText(['失败', '未执行'])
  const shot = page.getByTestId('fail-shot')
  await expect(shot).toBeVisible()
  // 截图确实加载成功
  expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
})

test('未配置模型时自然语言步骤标记为跳过，代码步骤照常执行', async ({ page }) => {
  await page.goto('/cases')
  await row(page, '错误密码提示').getByTestId('run').click()
  await expect(page.getByTestId('run-status')).toHaveText('通过', { timeout: 30_000 })
  await expect(page.getByTestId('step-status')).toHaveText(['通过', '通过', '跳过'])
  await expect(page.getByText('个自然语言步骤因未配置模型被跳过')).toBeVisible()
})

test('编辑与删除用例', async ({ page }) => {
  await createCase(page, 'E2E 待编辑', [{ content: 'await page.title()' }])
  await row(page, 'E2E 待编辑').getByTestId('edit').click()
  await expect(page.getByTestId('case-name-input')).toHaveValue('E2E 待编辑')
  await page.getByTestId('case-name-input').fill('E2E 已改名')
  await page.getByTestId('save-case').click()
  await expect(row(page, 'E2E 已改名')).toHaveCount(1)

  page.once('dialog', (d) => d.accept())
  await row(page, 'E2E 已改名').getByTestId('delete').click()
  await expect(row(page, 'E2E 已改名')).toHaveCount(0)
})

test('表单校验：URL 不合法时给出提示', async ({ page }) => {
  await page.goto('/cases/new')
  await page.getByTestId('case-name-input').fill('坏 URL')
  await page.getByTestId('case-url-input').fill('ftp://example.com')
  await page.getByTestId('step-content').fill('点击登录')
  await page.getByTestId('save-case').click()
  await expect(page.getByTestId('form-error')).toContainText('目标 URL')
})

test('AI 生成页：未配置模型时提示且不可生成', async ({ page }) => {
  await page.goto('/generate')
  await expect(page.getByTestId('no-model')).toContainText('未配置大模型')
  await page.getByTestId('fill-example').click()
  await expect(page.getByTestId('generate')).toBeDisabled()
})

test('纯接口用例：不打开浏览器，报告展示请求与响应', async ({ page }) => {
  await page.goto('/cases')
  await row(page, '待办接口').getByTestId('run').click()
  await expect(page.getByTestId('run-status')).toHaveText('通过', { timeout: 30_000 })
  await expect(page.getByTestId('step-status')).toHaveText(Array(6).fill('通过'))
  const first = page.getByTestId('api-exchange').first()
  await expect(first).toContainText('POST')
  await expect(first).toContainText('200')
  await expect(first).toContainText('token =')
  await expect(page.getByText('纯接口用例（未打开浏览器）')).toBeVisible()
})

test('保存时校验接口步骤的 YAML', async ({ page }) => {
  await page.goto('/cases/new')
  await page.getByTestId('case-name-input').fill('坏的接口步骤')
  await page.getByTestId('case-url-input').fill('')
  await page.getByTestId('step-remove').click()
  await page.getByTestId('add-api-step').click()
  await page.getByTestId('step-content').fill('method: GET')
  await page.getByTestId('save-case').click()
  await expect(page.getByTestId('form-error')).toContainText('第 1 步接口定义有误：缺少 url')
})

test('用例集：新建 → 运行 → 批次汇总与 JUnit 下载', async ({ page }) => {
  await page.goto('/suites')
  await page.getByTestId('new-suite').click()
  await page.getByTestId('suite-name').fill('E2E 冒烟')
  await page.getByTestId('suite-case').filter({ hasText: '登录成功并添加待办' }).locator('input').check()
  await page.getByTestId('suite-case').filter({ hasText: '待办接口' }).locator('input').check()
  await page.getByTestId('save-suite').click()

  await page.getByTestId('suite-row').filter({ hasText: 'E2E 冒烟' }).getByTestId('run-suite').click()
  await expect(page).toHaveURL(/\/batches\/\d+$/)
  await expect(page.getByTestId('batch-status')).toHaveText('通过', { timeout: 30_000 })
  await expect(page.getByTestId('batch-run')).toHaveCount(2)

  const download = page.waitForEvent('download')
  await page.getByTestId('junit').click()
  expect((await download).suggestedFilename()).toMatch(/^batch-\d+-junit\.xml$/)
})

test('用例列表勾选多个用例批量运行', async ({ page }) => {
  await page.goto('/cases')
  await expect(page.getByTestId('run-picked')).toBeDisabled()
  await row(page, '待办接口').getByTestId('pick').check()
  await row(page, '错误密码提示').getByTestId('pick').check()
  await page.getByTestId('run-picked').click()
  await expect(page.getByTestId('batch-status')).toHaveText('通过', { timeout: 30_000 })
  await expect(page.getByTestId('batch-run')).toHaveCount(2)
})

test('环境：配置基础地址和预置本地存储，切换当前环境后运行用例', async ({ page, baseURL }) => {
  await page.goto('/environments')
  await page.getByTestId('new-env').click()
  await page.getByTestId('env-name').fill('E2E 环境')
  await page.getByTestId('env-base-url').fill(`${baseURL}/demo`)
  await page.getByTestId('env-vars').fill('USER=demo')
  await page.getByTestId('perm-camera').check()
  await page.getByTestId('env-storage').fill('e2e-flag=on')
  await page.getByTestId('save-env').click()
  await page.getByTestId('env-row').filter({ hasText: 'E2E 环境' }).getByTestId('use-env').click()
  await expect(page.getByTestId('env-select')).toHaveValue(/\d+/)

  await page.goto('/cases/new')
  await page.getByTestId('case-name-input').fill('E2E 按环境运行')
  await page.getByTestId('case-url-input').fill('{{BASE_URL}}/index.html')
  await page.getByTestId('step-remove').click()
  await page.getByTestId('add-code-step').click()
  await page.getByTestId('step-content').fill(
    "if (await page.evaluate(() => localStorage.getItem('e2e-flag')) !== 'on') throw new Error('未预置')\nawait page.fill('[data-test=username]', vars.USER)",
  )
  await page.getByTestId('save-case').click()
  await row(page, 'E2E 按环境运行').getByTestId('run').click()
  await expect(page.getByTestId('run-status')).toHaveText('通过', { timeout: 30_000 })
  await expect(page.getByTestId('run-env')).toHaveText('E2E 环境')

  // 切回默认环境后，缺少 BASE_URL 时给出明确提示
  await page.getByTestId('env-select').selectOption({ label: '默认（演示站点）' })
  await page.goto('/cases')
  page.once('dialog', (d) => d.dismiss())
  await row(page, 'E2E 按环境运行').getByTestId('run').click()
  await expect(page.getByTestId('list-error')).toContainText('{{BASE_URL}} 未定义')
})

test('鲁棒性对比：同一用例在三种界面变更下运行，矩阵展示每一步结果', async ({ page }) => {
  test.setTimeout(150_000) // “去掉测试标记”时每个选择器要等到超时才失败
  await page.goto('/cases')
  await row(page, '登录成功并添加待办').getByTestId('robustness').click()
  await expect(page).toHaveURL(/\/batches\/\d+$/)
  await expect(page.getByTestId('batch-status')).toHaveText('失败', { timeout: 120_000 })
  await expect(page.getByTestId('matrix-rate')).toHaveText(['100%', '0%', '100%'])
})

test('AI 兜底：代码步骤可设置兜底描述；未配置模型时报告说明无法自愈', async ({ page }) => {
  await page.goto('/cases/new')
  await page.getByTestId('case-name-input').fill('E2E 自愈')
  await page.getByTestId('step-remove').click()
  await page.getByTestId('add-code-step').click()
  await page.getByTestId('step-content').fill("await page.locator('[data-test=gone]').click({ timeout: 500 })")
  await page.getByTestId('fallback-toggle').check()
  await page.getByTestId('fallback-content').fill('点击登录按钮')
  await page.getByTestId('save-case').click()

  await row(page, 'E2E 自愈').getByTestId('edit').click()
  await expect(page.getByTestId('fallback-content')).toHaveValue('点击登录按钮')
  await page.goto('/cases')
  await row(page, 'E2E 自愈').getByTestId('run').click()
  await expect(page.getByTestId('run-status')).toHaveText('失败', { timeout: 30_000 })
  await expect(page.getByText('未配置模型，无法自愈')).toBeVisible()
  await expect(page.getByText('AI 兜底（断言）：点击登录按钮')).toBeVisible()
})
