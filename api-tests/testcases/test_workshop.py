"""用例工坊：需求 → 解析需求点 → 生成批次 → 审核入库 → 覆盖矩阵。

模型由本地假模型（e2e/mock-llm.ts）代替：解析固定返回 4 个需求点（第 4 个的摘录是编造的），
生成按请求里的需求点编号返回用例。
"""
import allure
import pytest

from common.assertions import assert_schema, assert_status
from common.schemas import COVERAGE, DRAFT, ERROR, GEN_BATCH, REQ_POINT

pytestmark = allure.feature("用例工坊")

DOC = """小待办（TodoLite）登录与待办管理：
1. 用户在登录页输入用户名和密码后点击“登录”，账号正确时进入“我的待办”页，标题显示“欢迎你，<用户名>”。
2. 用户名或密码错误时，停留在登录页，并在登录按钮下方显示红色提示“用户名或密码错误”。
3. 待办页可以在输入框输入内容后点击“添加”新增待办。"""


@pytest.fixture
def requirement(workshop):
    """造一个已解析的需求，用例结束后删除（级联删除需求点、批次与草稿）。"""
    resp = workshop.post("/api/requirements", json={"name": "接口测试-需求", "content": DOC})
    assert_status(resp, 201)
    req = resp.json()
    parsed = workshop.post(f"/api/requirements/{req['id']}/parse", json={})
    assert_status(parsed, 200)
    yield {**req, "points": parsed.json()["points"]}
    workshop.delete(f"/api/requirements/{req['id']}")


def _batch(workshop, req_id, scope="all"):
    resp = workshop.post(f"/api/requirements/{req_id}/batches", json={"scope": scope})
    assert_status(resp, 201)
    assert_schema(resp.json(), GEN_BATCH)
    return resp.json()


@allure.story("需求与解析")
@pytest.mark.parametrize("body, msg", [
    ({"name": "", "content": DOC}, "名称不能为空"),
    ({"name": "a", "content": "太短"}, "至少写 20 个字"),
    ({"name": "a", "content": "x" * 20001}, "不能超过 20000"),
    ({"name": "a", "content": DOC, "targetUrl": "ftp://x"}, "目标 URL"),
])
def test_requirement_validation(workshop, body, msg):
    resp = workshop.post("/api/requirements", json=body)
    assert_status(resp, 400)
    assert_schema(resp.json(), ERROR)
    assert msg in resp.json()["error"]


@allure.story("需求与解析")
def test_parse_points_with_excerpt_check(requirement):
    points = requirement["points"]
    for p in points:
        assert_schema(p, REQ_POINT)
    assert [p["code"] for p in points] == ["REQ-001", "REQ-002", "REQ-003", "REQ-004"]
    # 第 4 个点的摘录在原文中找不到 → 提示可能是模型编造
    assert [p["excerptFound"] for p in points] == [True, True, True, False]


@allure.story("需求与解析")
def test_edit_points_keeps_codes(workshop, requirement):
    rid = requirement["id"]
    kept = [{k: p[k] for k in ("id", "title", "detail", "priority", "sourceExcerpt")} for p in requirement["points"][:3]]
    resp = workshop.put(f"/api/requirements/{rid}/points", json={"points": [*kept, {"title": "人工补充", "priority": "P2"}]})
    assert_status(resp, 200)
    assert [p["code"] for p in resp.json()] == ["REQ-001", "REQ-002", "REQ-003", "REQ-005"], "删除的编号不复用"


@allure.story("生成批次")
def test_generate_batch_records_prompt_and_hash(workshop, requirement):
    batch = _batch(workshop, requirement["id"])
    assert batch["seq"] == 1 and batch["promptVersion"] == "v1" and batch["model"] == "mock-model"
    assert batch["stats"]["total"] == len(batch["drafts"]) == 4
    assert all(d["verdict"] == "pending" and d["caseId"] is None for d in batch["drafts"])
    # 相同输入的两批指纹一致，可直接对比
    assert _batch(workshop, requirement["id"])["inputHash"] == batch["inputHash"]


@allure.story("生成批次")
@pytest.mark.parametrize("body, msg", [
    ({"scope": [999999]}, "不存在或已移除"),
    ({"scope": "everything"}, "scope 只能是"),
    ({"promptVersion": "v99"}, "不存在"),
    ({"promptVersion": "../../etc/passwd"}, "不合法"),
])
def test_generate_validation(workshop, requirement, body, msg):
    resp = workshop.post(f"/api/requirements/{requirement['id']}/batches", json=body)
    assert_status(resp, 400)
    assert msg in resp.json()["error"]


@allure.story("审核")
def test_review_flow_and_metrics(workshop, requirement):
    batch = _batch(workshop, requirement["id"])
    d1, d2, d3, d4 = batch["drafts"]

    accepted = workshop.post(f"/api/drafts/{d1['id']}/review", json={"verdict": "accepted"})
    assert_status(accepted, 200)
    assert_schema(accepted.json(), DRAFT)
    assert accepted.json()["caseId"], "通过后入库"
    assert_status(workshop.get(f"/api/cases/{accepted.json()['caseId']}"), 200)

    final = {"name": d2["name"], "description": "", "url": d2["url"],
             "steps": [d2["steps"][0], {"type": "ai_assert", "content": "登录按钮下方显示“用户名或密码错误”"}]}
    edited = workshop.post(f"/api/drafts/{d2['id']}/review", json={"verdict": "edited", "final": final}).json()
    assert edited["verdict"] == "edited"
    assert edited["editStats"] == {"kept": 1, "changed": 1, "added": 0, "removed": 0, "nameChanged": False}
    assert edited["steps"] == d2["steps"], "原稿不可修改"

    workshop.post(f"/api/drafts/{d3['id']}/review", json={"verdict": "discarded", "reason": "not_executable"})
    workshop.post(f"/api/drafts/{d4['id']}/review", json={"verdict": "discarded", "reason": "out_of_scope"})

    stats = workshop.get(f"/api/gen-batches/{batch['id']}").json()["stats"]
    assert (stats["reviewed"], stats["accepted"], stats["edited"], stats["discarded"]) == (4, 1, 1, 2)
    assert stats["adoption"]["rate"] == 0.5
    lo, hi = stats["adoption"]["ci"]
    assert lo < 0.5 < hi
    assert stats["reasons"]["out_of_scope"] == 1 and stats["reasons"]["not_executable"] == 1


@allure.story("审核")
@pytest.mark.parametrize("body, status, msg", [
    ({"verdict": "maybe"}, 400, "verdict 只能是"),
    ({"verdict": "discarded"}, 400, "必须选择原因"),
    ({"verdict": "discarded", "reason": "other"}, 400, "填写备注"),
    ({"verdict": "discarded", "reason": "lazy"}, 400, "废弃原因不合法"),
    ({"verdict": "edited"}, 400, "终稿"),
    ({"verdict": "edited", "final": {"name": "x", "url": "{{DEMO}}/", "steps": []}}, 400, "至少需要一个步骤"),
    ({"verdict": "accepted", "pointIds": []}, 400, "至少要关联一个需求点"),
    ({"verdict": "accepted", "pointIds": [999999]}, 400, "不属于这个需求"),
])
def test_review_validation(workshop, requirement, body, status, msg):
    draft = _batch(workshop, requirement["id"])["drafts"][0]
    resp = workshop.post(f"/api/drafts/{draft['id']}/review", json=body)
    assert_status(resp, status)
    assert msg in resp.json()["error"]


@allure.story("审核")
def test_review_twice_conflict(workshop, requirement):
    draft = _batch(workshop, requirement["id"])["drafts"][0]
    assert_status(workshop.post(f"/api/drafts/{draft['id']}/review", json={"verdict": "accepted"}), 200)
    resp = workshop.post(f"/api/drafts/{draft['id']}/review", json={"verdict": "discarded", "reason": "duplicate"})
    assert_status(resp, 409)
    assert resp.json()["code"] == "CONFLICT"


@allure.story("覆盖矩阵")
def test_coverage_and_gap_generation(workshop, requirement):
    rid = requirement["id"]
    batch = _batch(workshop, rid)
    by_name = {d["name"]: d for d in batch["drafts"]}
    workshop.post(f"/api/drafts/{by_name['正确账号登录显示欢迎语']['id']}/review", json={"verdict": "accepted"})

    cov = workshop.get(f"/api/requirements/{rid}/coverage").json()
    assert_schema(cov, COVERAGE)
    status = {r["point"]["code"]: r["status"] for r in cov["rows"]}
    assert status == {"REQ-001": "linked", "REQ-002": "uncovered", "REQ-003": "uncovered", "REQ-004": "uncovered"}
    assert [p["code"] for p in cov["p0Uncovered"]] == ["REQ-003"]
    assert cov["timeline"][0]["linked"] == 1

    # 只针对未覆盖的点补生成：范围不含 REQ-001
    gap = _batch(workshop, rid, scope="uncovered")
    codes = {p["id"]: p["code"] for p in gap["points"]}
    assert sorted(codes[i] for i in gap["scope"]) == ["REQ-002", "REQ-003", "REQ-004"]

    csv = workshop.get(f"/api/requirements/{rid}/coverage.csv")
    assert_status(csv, 200)
    assert "text/csv" in csv.headers["content-type"]
    assert "REQ-001" in csv.content.decode("utf-8-sig")


@allure.story("Prompt 版本")
def test_prompt_versions(workshop):
    resp = workshop.get("/api/prompts")
    assert_status(resp, 200)
    versions = {f"{p['kind']}-{p['version']}" for p in resp.json()}
    assert {"parse-v1", "gen-v1"} <= versions
    assert all(p["summary"] for p in resp.json()), "每个 Prompt 文件第一行要写说明"
