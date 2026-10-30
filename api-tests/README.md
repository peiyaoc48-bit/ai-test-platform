# 平台接口自动化测试（pytest + requests）

用 Python 直接测试平台后端的 REST 接口，不经过页面。

```bash
npm run test:api:setup   # 首次：创建虚拟环境并安装依赖
npm run test:api         # 自动启动一个临时平台实例（端口 3197）并执行全部接口用例
```

- 测试已有环境：`API_BASE_URL=http://127.0.0.1:3100 npm run test:api`（不会自动启动实例）
- 只跑冒烟：`cd api-tests && .venv/bin/pytest -m smoke`；跳过需要浏览器的用例：`-m "not slow"`
- Allure 报告：`.venv/bin/pytest --alluredir=allure-results`，再用 `allure serve allure-results` 查看

## 分层

| 目录 | 职责 |
|---|---|
| `common/client.py` | 接口客户端：封装 requests，统一超时、日志和 Allure 附件；提供 `create_case`、`run_case`、`wait_run` 等业务方法 |
| `common/schemas.py` | 接口契约（JSON Schema），字段改名或类型变化会被契约测试发现 |
| `common/assertions.py` | 断言：状态码、契约、响应耗时，失败时附带响应体 |
| `data/*.yaml` | 测试数据，参数校验用例由数据驱动 |
| `conftest.py` | 夹具：启动临时平台实例、接口客户端、造数据并在用例结束后自动清理 |
| `testcases/` | 用例：用例管理 CRUD、参数校验、异步执行、失败报告、统计口径、AI 生成接口 |

## 覆盖点

- **CRUD 与契约**：201 / 200 / 204 / 404、首尾空格处理、修改不改变创建时间、重复删除
- **参数校验**（数据驱动）：空值、超长、类型错误、非法协议（`ftp:`、`javascript:`）、边界值（50 步可以，51 步不行）
- **异步接口**：提交返回 202 → 轮询到终态；串行队列顺序；失败后剩余步骤为 `not_run`；失败截图可以下载且是 JPEG
- **数据一致性**：运行记录保存用例快照，用例改名不影响历史报告；统计接口用“增量”断言，不依赖共享环境里的已有数据
- **AI 接口**：未配置模型时返回 `MODEL_NOT_CONFIGURED`，提示里说明如何配置；不消耗真实 token
