"""用例管理接口：增删改查 + 契约 + 异常路径。"""
import allure
import pytest

from common.assertions import assert_fast, assert_schema, assert_status
from common.schemas import CASE, ERROR

pytestmark = allure.feature("用例管理接口")

STEPS = [
    {"type": "code", "content": "await page.title()"},
    {"type": "ai_assert", "content": "页面显示登录表单"},
]


@pytest.mark.smoke
@allure.story("新建 → 查询 → 修改 → 删除")
def test_case_lifecycle(api):
    resp = api.create_case({"name": " 生命周期用例 ", "url": "{{DEMO}}/index.html", "steps": STEPS})
    assert_status(resp, 201)
    case = resp.json()
    assert_schema(case, CASE)
    assert case["name"] == "生命周期用例", "名称首尾空格应被去掉"
    assert case["description"] == "", "缺省描述应为空字符串"

    got = api.get_case(case["id"])
    assert_status(got, 200)
    assert got.json() == case

    updated = api.update_case(case["id"], {**case, "name": "已改名", "steps": STEPS[:1]})
    assert_status(updated, 200)
    assert updated.json()["name"] == "已改名"
    assert updated.json()["steps"] == STEPS[:1]
    assert updated.json()["createdAt"] == case["createdAt"], "修改不应改变创建时间"

    assert_status(api.delete_case(case["id"]), 204)
    assert_status(api.get_case(case["id"]), 404)
    assert_status(api.delete_case(case["id"]), 404), "重复删除应返回 404"


@allure.story("列表")
def test_list_contains_new_case_and_is_desc(api, case_factory):
    a = case_factory(name="列表-A")
    b = case_factory(name="列表-B")
    resp = api.get("/api/cases")
    assert_status(resp, 200)
    assert_fast(resp, 500)
    ids = [c["id"] for c in resp.json()]
    assert ids.index(b["id"]) < ids.index(a["id"]), "列表应按 id 倒序"
    for c in resp.json():
        assert_schema({k: v for k, v in c.items() if k != "lastRun"}, CASE)


@allure.story("异常路径")
@pytest.mark.parametrize(
    "method, path, expected",
    [
        ("GET", "/api/cases/999999", 404),
        ("PUT", "/api/cases/999999", 404),
        ("DELETE", "/api/cases/999999", 404),
        ("GET", "/api/cases/abc", 400),
        ("GET", "/api/cases/-1", 400),
        ("POST", "/api/cases/999999/run", 404),
        ("GET", "/api/runs/999999", 404),
    ],
)
def test_not_found_and_bad_id(api, method, path, expected):
    body = {"name": "x", "url": "{{DEMO}}/index.html", "steps": STEPS} if method == "PUT" else None
    resp = api.request(method, path, json=body)
    assert_status(resp, expected)
    assert_schema(resp.json(), ERROR)


@allure.story("异常路径")
def test_non_json_body_is_rejected(api):
    resp = api.post("/api/cases", data="name=x", headers={"content-type": "text/plain"})
    assert resp.status_code in (400, 415)
