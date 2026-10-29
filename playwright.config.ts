import { defineConfig } from '@playwright/test'

// 平台自身的端到端测试。起两套独立实例（各自的临时数据目录）：
//   - nomodel：不配置模型，验证离线链路与“未配置”提示
//   - mockmodel：指向本地假模型，验证 AI 生成用例的审核入库流程
// 运行前需先构建前端：npm run test:e2e 会自动执行 vite build。
const channel = process.env.BROWSER_CHANNEL ?? 'chrome'
const platform = (port: number, name: string, env: string) =>
  `rm -rf test-results/e2e-data-${name} && ${env} PORT=${port} DATA_DIR=test-results/e2e-data-${name} ` +
  `BROWSER_CHANNEL=${channel} NODE_ENV=production npx tsx server/index.ts`

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { testIdAttribute: 'data-test', channel: channel || undefined, viewport: { width: 1280, height: 860 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'nomodel', testMatch: /.*\.nomodel\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:3199' } },
    { name: 'mockmodel', testMatch: /.*\.mockmodel\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:3198' } },
  ],
  webServer: [
    { command: 'npx tsx e2e/mock-llm.ts', url: 'http://127.0.0.1:3297/health', reuseExistingServer: false },
    {
      command: platform(3199, 'nomodel', 'MIDSCENE_MODEL_API_KEY='),
      url: 'http://127.0.0.1:3199/api/config',
      reuseExistingServer: false,
    },
    {
      command: platform(
        3198,
        'mockmodel',
        'MIDSCENE_MODEL_BASE_URL=http://127.0.0.1:3297/v1 MIDSCENE_MODEL_API_KEY=mock-key MIDSCENE_MODEL_NAME=mock-model GEN_MODEL_NAME=mock-model',
      ),
      url: 'http://127.0.0.1:3198/api/config',
      reuseExistingServer: false,
    },
  ],
})
