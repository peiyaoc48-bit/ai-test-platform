"""统计接口：口径校验（共享环境下用“增量”断言，不依赖库里已有数据）。"""
import allure

from common.assertions import assert_schema, assert_status
from common.schemas import STATS

pytestmark = allure.feature("执行与报告接口")


@allure.story("统计口径")
def test_stats_counts_follow_runs(api, case_factory):
    ok = case_factory(name="统计-通过")
    bad = case_factory(name="统计-失败", steps=[{"type": "code", "content": "throw new Error('boom')"}])
    skip = case_factory(name="统计-跳过", steps=[{"type": "ai_action", "content": "点击登录"}])

    before = api.get("/api/stats?days=1").json()
    for c in (ok, ok, bad, skip):
        api.wait_run(api.run_case(c["id"]).json()["runId"])
    resp = api.get("/api/stats?days=1")
    assert_status(resp, 200)
    after = resp.json()
    assert_schema(after, STATS)

    assert after["totalRuns"] - before["totalRuns"] == 4
    assert after["passedRuns"] - before["passedRuns"] == 2
    assert after["failedRuns"] - before["failedRuns"] == 1, "全部跳过的运行不计入失败"

    per_case = api.get(f"/api/stats?caseId={ok['id']}").json()
    assert per_case["totalRuns"] == 2 and per_case["passRate"] == 1
    assert api.get(f"/api/stats?caseId={skip['id']}").json()["passRate"] is None, "只有跳过的运行时通过率为空"


@allure.story("参数容错")
def test_stats_query_params_are_clamped(api):
    for q in ("days=abc", "days=-5", "days=100000"):
        assert_status(api.get(f"/api/stats?{q}"), 200)
