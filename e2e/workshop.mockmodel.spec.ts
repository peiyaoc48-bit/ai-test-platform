import { expect, test } from '@playwright/test'

// 使用本地假模型（e2e/mock-llm.ts）验证用例工坊闭环：
// 新建需求 → 解析需求点（编造的摘录被标红）→ 生成批次 → 键盘审核（废弃 / 通过 / 修改）→ 批次度量 → 覆盖矩阵补生成
const DOC = `小待办（TodoLite）登录与待办管理：
1. 用户在登录页输入用户名和密码后点击“登录”，账号正确时进入“我的待办”页，标题显示“欢迎你，<用户名>”。演示账号 demo / demo123。
2. 用户名或密码错误时，停留在登录页，并在登录按钮下方显示红色提示“用户名或密码错误”。
3. 待办页可以在输入框输入内容后点击“添加”新增待办。`

test('用例工坊：解析 → 生成 → 审核 → 度量 → 覆盖矩阵', async ({ page }) => {
  await page.goto('/workshop')
  await page.getByTestId('new-requirement').click()
  await page.getByTestId('req-name').fill('TodoLite 登录与待办（E2E）')
  await page.getByTestId('req-content').fill(DOC)
  await page.getByTestId('save-requirement').click()
  await expect(page).toHaveURL(/\/workshop\/requirements\/\d+$/)
  const reqUrl = page.url()

  // 解析：4 个需求点，第 4 个的摘录在原文里找不到
  await page.getByTestId('parse').click()
  const rows = page.getByTestId('point-row')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0)).toContainText('REQ-001')
  await expect(rows.nth(3).locator('.excerpt.bad')).toHaveCount(1)
  await expect(page.getByTestId('p0-alert')).toBeVisible()

  // 生成一批（全部需求点）→ 自动进入审核工作台
  await page.getByTestId('tab-batches').click()
  await page.getByTestId('generate-batch').click()
  await expect(page).toHaveURL(/\/workshop\/batches\/\d+\/review$/)
  await expect(page.getByTestId('queue-item')).toHaveCount(4)

  // 队列按置信度从低到高：第一条是编造需求点生成的用例 → 废弃（需求外）
  await expect(page.locator('.d-head h2')).toHaveText('连续输错三次密码被锁定')
  await page.keyboard.press('d')
  await page.keyboard.press('2')
  await expect(page.getByTestId('reason-out_of_scope')).toHaveClass(/on/)
  await page.keyboard.press('Enter')

  // 第二条：通过
  await expect(page.locator('.d-head h2')).toHaveText('登录后新增待办')
  await page.keyboard.press('a')

  // 第三条：断言含糊，修改后通过
  await expect(page.locator('.d-head h2')).toHaveText('密码错误时提示')
  await page.keyboard.press('e')
  await page.getByTestId('step-content').nth(1).fill('登录按钮下方显示红色提示“用户名或密码错误”')
  await page.getByTestId('save-edit').click()

  // 第四条：通过
  await expect(page.locator('.d-head h2')).toHaveText('正确账号登录显示欢迎语')
  await page.getByTestId('accept').click()
  await expect(page.getByText('本批 4 条草稿已全部审核')).toBeVisible()

  // 批次度量
  await page.getByRole('link', { name: '查看批次度量' }).click()
  await expect(page.locator('.summary')).toContainText('75.0%')
  await expect(page.locator('.summary')).toContainText('3/4')
  await expect(page.getByTestId('draft-row').filter({ hasText: '密码错误时提示' })).toContainText('改 1')
  await expect(page.getByTestId('draft-row').filter({ hasText: '连续输错三次' })).toContainText('需求外（幻觉）')

  // 入库：3 条用例出现在用例列表
  const cases = await (await page.request.get('/api/cases')).json()
  expect(cases.filter((c: { name: string }) => ['正确账号登录显示欢迎语', '登录后新增待办', '密码错误时提示'].includes(c.name))).toHaveLength(3)

  // 覆盖矩阵：REQ-004 未覆盖；勾选后只针对它补生成
  await page.goto(`${reqUrl}?tab=coverage`)
  await page.getByTestId('cov-filter-uncovered').click()
  const covRows = page.getByTestId('coverage-row')
  await expect(covRows).toHaveCount(1)
  await expect(covRows.first()).toContainText('REQ-004')
  await covRows.first().locator('input[type=checkbox]').check()
  await page.getByRole('button', { name: /只针对选中的 1 个生成/ }).click()
  await expect(page.getByTestId('tab-batches')).toHaveClass(/on/)
  await page.getByTestId('generate-batch').click()
  await expect(page).toHaveURL(/\/review$/)
  await expect(page.getByTestId('queue-item')).toHaveCount(1)
})
