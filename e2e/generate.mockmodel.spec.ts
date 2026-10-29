import { expect, test } from '@playwright/test'

// 使用本地假模型（e2e/mock-llm.ts）验证：生成草稿 → 人工取舍与修改 → 入库
test('AI 生成用例：草稿审核后才入库', async ({ page }) => {
  await page.goto('/cases')
  const before = await page.getByTestId('case-row').count()

  await page.goto('/generate')
  await expect(page.getByTestId('no-model')).toHaveCount(0)
  await page.getByTestId('fill-example').click()
  await page.getByTestId('generate').click()

  const drafts = page.getByTestId('draft')
  await expect(drafts).toHaveCount(2)
  await expect(page.getByText('1,048 tokens')).toBeVisible()

  // 生成后尚未入库
  expect((await (await page.request.get('/api/cases')).json()).length).toBe(before)

  // 取消第二条，修改第一条名称
  await drafts.nth(1).getByLabel('采纳').uncheck()
  await drafts.nth(0).locator('input.input').first().fill('正确账号登录（已审核）')
  await page.getByTestId('save-drafts').click()

  await expect(page).toHaveURL(/\/cases$/)
  await expect(page.getByTestId('case-row')).toHaveCount(before + 1)
  await expect(page.getByTestId('case-name').first()).toHaveText('正确账号登录（已审核）')
  await expect(page.getByText('密码错误时提示')).toHaveCount(0)
})
