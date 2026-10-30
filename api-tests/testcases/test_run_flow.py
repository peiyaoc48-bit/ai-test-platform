"""执行接口：异步提交 → 轮询 → 断言结果。会真实启动浏览器跑演示站点。"""
import allure
import pytest

from common.assertions import assert_schema, assert_status
from common.schemas import RUN

pytestmark = [allure.feature("执行与报告接口"), pytest.mark.slow]

LOGIN = (
    "await page.fill('[data-test=username]', 'demo')\n"
    "await page.fill('[data-test=password]', 'demo123')\n"
    "await page.click('[data-test=submit]')"
)


@pytest.mark.smoke
@allure.story("异步执行")
def test_run_returns_202_then_passes(api, case_factory):
    case = case_factory(steps=[
        {"type": "code", "content": LOGIN},
        {"type": "code", "content": "await expect(page.locator('[data-test=welcome]')).toContainText('demo')"},
    ])
    resp = api.run_case(case["id"])
    assert_status(resp, 202)
    run_id = resp.json()["runId"]

    # 刚提交时应处于排队或运行中（异步），而不是同步等到结束
    first = api.get_run(run_id).json()
    assert first["status"] in ("queued", "running", "passed")

    run = api.wait_run(run_id)
    assert_schema(run, RUN)
    assert run["status"] == "passed"
    assert [s["status"] for s in run["steps"]] == ["passed", "passed"]
    assert run["caseId"] == case["id"]
    assert run["url"].endswith("/demo/index.html"), "{{DEMO}} 占位符应被替换为真实地址"


@allure.story("失败报告")
def test_failed_step_has_error_and_screenshot(api, case_factory):
    case = case_factory(steps=[
        {"type": "code", "content": "await expect(page.locator('h1')).toHaveText('注册', { timeout: 500 })"},
        {"type": "code", "content": "await page.click('[data-test=submit]')"},
    ])
    run = api.wait_run(api.run_case(case["id"]).json()["runId"])
    assert run["status"] == "failed"
    failed, rest = run["steps"]
    assert failed["status"] == "failed" and "toHaveText" in failed["error"]
    assert rest["status"] == "not_run", "失败后剩余步骤不应执行"

    shot = api.get(f"/artifacts/{failed['screenshot']}")
    assert_status(shot, 200)
    assert shot.headers["content-type"] == "image/jpeg"
    assert len(shot.content) > 1000


@allure.story("未配置模型")
def test_ai_steps_skipped_without_model(api, case_factory):
    case = case_factory(steps=[
        {"type": "code", "content": "await page.title()"},
        {"type": "ai_assert", "content": "页面上有登录按钮"},
    ])
    run = api.wait_run(api.run_case(case["id"]).json()["runId"])
    assert run["status"] == "passed"
    assert run["steps"][1]["status"] == "skipped"
    assert run["steps"][1]["error"] == "跳过（未配置模型）"
    assert run["aiCalls"] == 0 and run["tokens"] == 0


@allure.story("报告快照")
def test_run_keeps_case_snapshot_after_case_changes(api, case_factory):
    """运行记录保存的是当时的用例快照：用例改名后历史报告不受影响。"""
    case = case_factory(name="快照-原名")
    run_id = api.run_case(case["id"]).json()["runId"]
    api.wait_run(run_id)
    api.update_case(case["id"], {**case, "name": "快照-新名"})
    assert api.get_run(run_id).json()["caseName"] == "快照-原名"


@allure.story("异步执行")
def test_runs_are_queued_in_order(api, case_factory):
    case = case_factory()
    run_ids = [api.run_case(case["id"]).json()["runId"] for _ in range(3)]
    assert run_ids == sorted(run_ids)
    runs = [api.wait_run(r) for r in run_ids]
    assert all(r["status"] == "passed" for r in runs)
    # 串行队列：后提交的运行不会早于先提交的开始
    starts = [r["startedAt"] for r in runs]
    assert starts == sorted(starts)

    listed = api.get(f"/api/runs?caseId={case['id']}").json()
    assert [r["id"] for r in listed] == sorted(run_ids, reverse=True)
